# ─────────────────────────────────────────────────────────────────────────────
# Debug Routes — for development and pipeline debugging
# ─────────────────────────────────────────────────────────────────────────────
# Only mounted when settings.enable_debug_routes is True.
# These will be used in Prompts 03/04 for step-by-step pipeline debugging.
# ─────────────────────────────────────────────────────────────────────────────

import io
import time
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from app.cache.shape_cache import ShapeCache
from app.dependencies import get_cache, get_model_registry
from app.exceptions import ModelNotLoadedError
from app.models.registry import ModelRegistry
from app.pipeline.prompt_templates import get_canonical_prompt
from app.pipeline.template_matcher import get_template
from app.schemas import HealthDetailResponse

router = APIRouter()

_start_time = time.time()


@router.get("/health", response_model=HealthDetailResponse)
async def health_detail(
    registry: ModelRegistry = Depends(get_model_registry),
    cache: ShapeCache = Depends(get_cache),
) -> HealthDetailResponse:
    """Full system diagnostics — GPU stats, cache info, uptime.

    Mounted at /debug/health. This is for humans and dashboards,
    NOT for Cloud Run probes (those use /health and /health/ready).
    """
    gpu_available = False
    gpu_name = None
    gpu_memory_used_gb = 0.0

    try:
        import torch

        gpu_available = torch.cuda.is_available()
        if gpu_available:
            gpu_name = torch.cuda.get_device_name(0)
            gpu_memory_used_gb = round(torch.cuda.memory_allocated() / 1e9, 1)
    except ImportError:
        pass

    cache_stats = await cache.stats()

    return HealthDetailResponse(
        status="healthy",
        models_loaded=registry.loaded_names,
        gpu_available=gpu_available,
        gpu_name=gpu_name,
        gpu_memory_used_gb=gpu_memory_used_gb,
        cache_connected=cache.is_connected,
        cache_stats=cache_stats,
        uptime_seconds=int(time.time() - _start_time),
    )


@router.get("/models")
async def list_models(
    registry: ModelRegistry = Depends(get_model_registry),
) -> dict[str, Any]:
    """List all loaded models and their status."""
    return {
        "models": registry.loaded_names,
        "count": len(registry.loaded_names),
    }


@router.get("/cache/stats")
async def cache_stats(
    cache: ShapeCache = Depends(get_cache),
) -> dict[str, Any]:
    """Return detailed cache statistics."""
    return await cache.stats()


@router.post("/cache/clear")
async def cache_clear(
    cache: ShapeCache = Depends(get_cache),
) -> dict[str, Any]:
    """Clear the in-memory cache. Cloud Storage is not affected."""
    cache.clear_memory()
    return {"status": "cleared"}


# ── SDXL Turbo debug endpoint ───────────────────────────────────────────────


class GenerateImageRequest(BaseModel):
    """Request body for the debug image generation endpoint."""

    text: str


@router.post("/generate-image")
async def generate_image(
    request: GenerateImageRequest,
    registry: ModelRegistry = Depends(get_model_registry),
) -> Response:
    """Generate a reference image via SDXL Turbo and return as PNG.

    This lets you visually verify that SDXL produces good reference
    images before wiring in the mesh generator (Prompt 04).

    Raises ModelNotLoadedError (503) if SDXL Turbo is not loaded.
    """
    if not registry.has("sdxl_turbo"):
        raise ModelNotLoadedError("sdxl_turbo")

    template = get_template(request.text)
    prompt = get_canonical_prompt(request.text, template.template_type)

    sdxl = registry.get("sdxl_turbo")
    image = sdxl.generate(prompt)

    # Encode PIL image → PNG bytes
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    buf.seek(0)

    return Response(content=buf.read(), media_type="image/png")


# ── PartCrafter debug endpoint ───────────────────────────────────────────────


@router.post("/generate-mesh")
async def generate_mesh(
    request: GenerateImageRequest,
    registry: ModelRegistry = Depends(get_model_registry),
) -> dict[str, Any]:
    """Run the full SDXL → PartCrafter → point sampling pipeline.

    Returns structured JSON with timing breakdown, part counts,
    and vertex counts — for debugging PartCrafter output quality.
    """
    if not registry.has("sdxl_turbo"):
        raise ModelNotLoadedError("sdxl_turbo")
    if not registry.has("partcrafter"):
        raise ModelNotLoadedError("partcrafter")

    template = get_template(request.text)
    prompt = get_canonical_prompt(request.text, template.template_type)

    # Step 1: SDXL Turbo image
    sdxl = registry.get("sdxl_turbo")
    t0 = time.perf_counter()
    image = sdxl.generate(prompt)
    image_ms = round((time.perf_counter() - t0) * 1000, 1)

    # Step 2: PartCrafter meshes
    partcrafter = registry.get("partcrafter")
    t1 = time.perf_counter()
    meshes = partcrafter.generate(image, num_parts=template.num_parts)
    mesh_ms = round((time.perf_counter() - t1) * 1000, 1)

    # Step 3: Point sampling
    from app.pipeline.point_sampler import sample_from_part_meshes

    valid_meshes = [m for m in meshes if len(m.vertices) > 1]
    t2 = time.perf_counter()
    positions, part_ids = sample_from_part_meshes(valid_meshes, total_points=2048)
    sample_ms = round((time.perf_counter() - t2) * 1000, 1)

    return {
        "text": request.text,
        "template_type": template.template_type,
        "num_parts_requested": template.num_parts,
        "num_parts_generated": len(meshes),
        "num_real_parts": len(valid_meshes),
        "vertices_per_part": [len(m.vertices) for m in meshes],
        "total_points": len(positions),
        "timing": {
            "image_ms": image_ms,
            "mesh_ms": mesh_ms,
            "sample_ms": sample_ms,
            "total_ms": round(image_ms + mesh_ms + sample_ms, 1),
        },
        "positions_shape": list(positions.shape),
    }
