# Core generation orchestrator: cache → template → models → points.
# Primary (SDXL+PartCrafter) falls back to Hunyuan3D+Grounded SAM on failure.


import asyncio
import time

import numpy as np
import structlog
from opentelemetry import trace

from app.cache.shape_cache import ShapeCache
from app.config import Settings
from app.exceptions import (
    GenerationFailedError,
    GenerationRateLimitError,
    GenerationTimeoutError,
    GPUOutOfMemoryError,
)
from app.models.registry import ModelRegistry
from app.pipeline.encoding import compute_bbox, encode_float32, encode_uint8
from app.pipeline.mask_to_faces import map_masks_to_faces
from app.pipeline.mesh_renderer import render_multiview_with_id_pass
from app.pipeline.point_sampler import (
    normalize_positions,
    sample_from_labeled_mesh,
    sample_from_part_meshes,
)
from app.pipeline.prompt_templates import get_canonical_prompt
from app.pipeline.template_matcher import TemplateInfo, get_template
from app.schemas import BoundingBox, GenerateRequest, GenerateResponse
from app.services.metrics import PipelineMetrics

logger = structlog.get_logger(__name__)
tracer = trace.get_tracer(__name__)


class PipelineOrchestrator:
    """Orchestrates generation pipeline: cache → image → mesh → points."""

    def __init__(
        self,
        registry: ModelRegistry,
        cache: ShapeCache,
        settings: Settings,
        metrics: PipelineMetrics | None = None,
    ) -> None:
        self._registry = registry
        self._cache = cache
        self._settings = settings
        self._metrics = metrics

    async def generate(self, request: GenerateRequest) -> GenerateResponse:
        """Full generation pipeline: cache → template → models → points."""
        with tracer.start_as_current_span("generate") as span:
            span.set_attribute("concept", request.text)
            return await self._generate_traced(request, span)

    async def _generate_traced(
        self, request: GenerateRequest, parent_span: trace.Span
    ) -> GenerateResponse:
        """Inner generate with OTel tracing."""
        start = time.perf_counter()

        with tracer.start_as_current_span("cache_lookup"):
            cached = await self._cache.get(request.text)
        if cached is not None:
            cached.cached = True
            cached.generation_time_ms = int((time.perf_counter() - start) * 1000)
            parent_span.set_attribute("cached", True)
            parent_span.set_attribute("pipeline_used", "cache")
            if self._metrics:
                self._metrics.record_request("cache", 0, cached=True)
            return cached
        parent_span.set_attribute("cached", False)

        # Inner rate limit protects GPU cost (separate from outer HTTP DoS limit)
        if self._metrics:
            gen_limit = self._settings.generation_rate_limit_per_minute
            recent = self._metrics.recent_generations_per_minute()
            if recent >= gen_limit:
                retry_after = self._metrics.oldest_generation_retry_after()
                logger.warning(
                    "generation_rate_limited",
                    text=request.text,
                    recent_generations=recent,
                    limit=gen_limit,
                    retry_after=retry_after,
                )
                raise GenerationRateLimitError(gen_limit, retry_after)
        template = get_template(request.text)
        logger.info(
            "generating",
            text=request.text,
            template=template.template_type,
            parts=template.num_parts,
        )

        # Generate with timeout + GPU error recovery
        try:
            positions, part_ids, part_names, pipeline_used = await asyncio.wait_for(
                self._run_in_executor(request.text, template),
                timeout=self._settings.generation_timeout_seconds,
            )
        except TimeoutError:
            raise GenerationTimeoutError(
                request.text, self._settings.generation_timeout_seconds
            ) from None
        except Exception as e:
            # Catch CUDA OOM directly — more precise than string matching
            _is_oom = False
            try:
                import torch

                if isinstance(e, torch.cuda.OutOfMemoryError):
                    torch.cuda.empty_cache()
                    _is_oom = True
            except ImportError:
                pass
            if _is_oom:
                raise GPUOutOfMemoryError() from e
            raise GenerationFailedError(request.text, str(e)) from e

        elapsed = int((time.perf_counter() - start) * 1000)
        bbox = compute_bbox(positions)

        response = GenerateResponse(
            positions=encode_float32(positions),
            part_ids=encode_uint8(part_ids),
            part_names=part_names,
            template_type=template.template_type,
            bounding_box=BoundingBox(min=bbox["min"], max=bbox["max"]),
            cached=False,
            generation_time_ms=elapsed,
            pipeline=pipeline_used,
        )

        async def _write_cache() -> None:
            try:
                with tracer.start_as_current_span("cache_write"):
                    await self._cache.set(request.text, response)
            except Exception:
                logger.warning("cache_write_failed", text=request.text, exc_info=True)

        asyncio.create_task(_write_cache())

        parent_span.set_attribute("pipeline_used", pipeline_used)
        parent_span.set_attribute("latency_ms", elapsed)

        logger.info(
            "generated",
            text=request.text,
            time_ms=elapsed,
            pipeline=pipeline_used,
            parts=template.num_parts,
        )
        if self._metrics:
            self._metrics.record_request(pipeline_used, elapsed, cached=False)
        return response

    async def _run_in_executor(
        self, text: str, template: TemplateInfo
    ) -> tuple[np.ndarray, np.ndarray, list[str], str]:
        """Run synchronous GPU work in a thread to avoid blocking the event loop."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._generate_sync, text, template)

    def _generate_sync(
        self, text: str, template: TemplateInfo
    ) -> tuple[np.ndarray, np.ndarray, list[str], str]:
        """Synchronous GPU pipeline. Primary: SDXL+PartCrafter. Fallback: Hunyuan3D+Grounded SAM."""
        total_points = self._settings.max_points

        # Canonical prompt
        prompt = get_canonical_prompt(text, template.template_type)
        logger.info("canonical_prompt", prompt=prompt)

        pipeline_used = "mock"
        reference_image = None

        if self._registry.has("sdxl_turbo"):
            sdxl = self._registry.get("sdxl_turbo")
            t0 = time.perf_counter()
            reference_image = sdxl.generate(prompt)
            image_ms = round((time.perf_counter() - t0) * 1000, 1)
            logger.info(
                "sdxl_image_generated",
                size=f"{reference_image.width}x{reference_image.height}",
                text=text,
                time_ms=image_ms,
            )
            pipeline_used = "sdxl_turbo+mock"

        if reference_image is not None and self._registry.has("partcrafter"):
            partcrafter = self._registry.get("partcrafter")
            t0 = time.perf_counter()
            part_meshes = partcrafter.generate(reference_image, num_parts=template.num_parts)
            mesh_ms = round((time.perf_counter() - t0) * 1000, 1)

            real_count = sum(1 for m in part_meshes if len(m.vertices) > 1)

            if real_count < max(template.num_parts * 0.5, 1):
                logger.warning(
                    "partcrafter_insufficient_parts",
                    text=text,
                    expected=template.num_parts,
                    real=real_count,
                    total=len(part_meshes),
                )

            valid_meshes = [m for m in part_meshes if len(m.vertices) > 1]
            if not valid_meshes:
                logger.error("partcrafter_all_meshes_failed", text=text)
            else:
                t1 = time.perf_counter()
                positions, part_ids = sample_from_part_meshes(
                    valid_meshes, total_points=total_points
                )
                sample_ms = round((time.perf_counter() - t1) * 1000, 1)

                part_names = template.part_names[: len(valid_meshes)]
                pipeline_used = "partcrafter"

                logger.info(
                    "primary_pipeline_complete",
                    text=text,
                    real_parts=real_count,
                    total_parts=len(part_meshes),
                    image_ms=image_ms,
                    mesh_ms=mesh_ms,
                    sample_ms=sample_ms,
                )

                return positions, part_ids, part_names, pipeline_used

        # Fallback: Hunyuan3D + Grounded SAM (lazy-loaded)
        if reference_image is not None:
            try:
                fallback_t0 = time.perf_counter()

                from app.models.grounded_sam import GroundedSAM2Model
                from app.models.hunyuan3d import Hunyuan3DTurboModel

                hunyuan = self._registry.get_or_load(
                    "hunyuan3d_turbo",
                    lambda: Hunyuan3DTurboModel(device="cuda"),
                )
                grounded_sam = self._registry.get_or_load(
                    "grounded_sam2",
                    lambda: GroundedSAM2Model(device="cuda"),
                )

                mesh = hunyuan.generate(reference_image)
                step_a_ms = round((time.perf_counter() - fallback_t0) * 1000, 1)

                fallback_timeout = getattr(self._settings, "fallback_timeout_seconds", 120)
                if (time.perf_counter() - fallback_t0) > fallback_timeout:
                    logger.warning(
                        "fallback_timeout",
                        text=text,
                        elapsed_s=round(time.perf_counter() - fallback_t0, 1),
                    )
                    raise TimeoutError("Fallback pipeline exceeded timeout")

                step_b_t0 = time.perf_counter()
                view_results = render_multiview_with_id_pass(mesh)
                step_b_ms = round((time.perf_counter() - step_b_t0) * 1000, 1)

                step_c_t0 = time.perf_counter()
                views_for_mapping = []
                for color_img, face_id_map in view_results:
                    masks = grounded_sam.segment(color_img, template.part_names)
                    views_for_mapping.append((masks, face_id_map))
                step_c_ms = round((time.perf_counter() - step_c_t0) * 1000, 1)

                step_d_t0 = time.perf_counter()
                face_centroids = mesh.triangles_center
                face_labels = map_masks_to_faces(
                    views_for_mapping,
                    face_centroids,
                    part_names=template.part_names,
                )
                step_d_ms = round((time.perf_counter() - step_d_t0) * 1000, 1)

                positions, part_ids = sample_from_labeled_mesh(
                    mesh, face_labels, total_points=total_points
                )
                pipeline_used = "hunyuan3d_grounded_sam"

                fallback_total_ms = round((time.perf_counter() - fallback_t0) * 1000, 1)
                logger.info(
                    "fallback_pipeline_complete",
                    text=text,
                    mesh_gen_ms=step_a_ms,
                    render_ms=step_b_ms,
                    segment_ms=step_c_ms,
                    mask_map_ms=step_d_ms,
                    total_ms=fallback_total_ms,
                    vertices=len(mesh.vertices),
                    faces=len(mesh.faces),
                )

                # Offload fallback models if VRAM > 80GB to prevent OOM
                try:
                    import torch

                    if torch.cuda.is_available():
                        allocated_gb = torch.cuda.memory_allocated() / 1e9
                        threshold = self._settings.vram_offload_threshold_gb
                        if allocated_gb > threshold:
                            logger.info(
                                "vram_offload_triggered",
                                allocated_gb=round(allocated_gb, 1),
                            )
                            self._registry.unload("hunyuan3d_turbo")
                            self._registry.unload("grounded_sam2")
                except ImportError:
                    pass

                return positions, part_ids, template.part_names, pipeline_used

            except Exception as e:
                # Check for CUDA OOM — re-raise for caller's OOM handler
                try:
                    import torch

                    if isinstance(e, torch.cuda.OutOfMemoryError):
                        raise
                except ImportError:
                    pass
                logger.warning(
                    "fallback_pipeline_failed",
                    text=text,
                    error=str(e),
                )

        # Final fallback: procedural sphere if all pipelines fail
        logger.warning("all_pipelines_failed_using_mock", text=text)
        rng = np.random.default_rng(hash(text) % (2**32))
        theta = rng.uniform(0, 2 * np.pi, total_points)
        phi = rng.uniform(0, np.pi, total_points)
        r = 0.8 + rng.normal(0, 0.1, total_points)
        positions = np.stack(
            [
                r * np.sin(phi) * np.cos(theta),
                r * np.sin(phi) * np.sin(theta),
                r * np.cos(phi),
            ],
            axis=1,
        ).astype(np.float32)

        positions, _ = normalize_positions(positions)
        part_ids = rng.integers(0, template.num_parts, total_points).astype(np.uint8)

        return positions, part_ids, template.part_names, pipeline_used
