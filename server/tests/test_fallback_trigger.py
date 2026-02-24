# ─────────────────────────────────────────────────────────────────────────────
# Integration test: fallback pipeline trigger + full output verification
# ─────────────────────────────────────────────────────────────────────────────
# Mocks all models to verify the orchestrator correctly wires:
# PartCrafter (insufficient parts) → Hunyuan3D → render → GSAM → mask map → points
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import PIL.Image
import pytest
import trimesh

from app.cache.shape_cache import ShapeCache
from app.config import Settings
from app.models.registry import ModelRegistry
from app.schemas import GenerateRequest
from app.services.pipeline import PipelineOrchestrator


def _make_mock_registry() -> ModelRegistry:
    """Create a registry with mocked primary models."""
    settings = Settings(
        cache_bucket="",
        skip_model_load=True,
    )
    registry = ModelRegistry(settings)

    # Mock SDXL Turbo — returns a dummy 512×512 image
    sdxl = MagicMock()
    sdxl.generate.return_value = PIL.Image.new("RGB", (512, 512), color="red")
    registry.register("sdxl_turbo", sdxl)

    # Mock PartCrafter — returns only dummy meshes (1 vertex each = filtered out)
    # This forces the fallback pipeline to trigger
    partcrafter = MagicMock()
    dummy = trimesh.Trimesh(vertices=[[0, 0, 0]], faces=[])
    partcrafter.generate.return_value = [dummy] * 6
    registry.register("partcrafter", partcrafter)

    return registry


def _make_mock_hunyuan() -> MagicMock:
    """Mock Hunyuan3D that returns a unit cube mesh."""
    hunyuan = MagicMock()
    hunyuan.name = "hunyuan3d_turbo"
    hunyuan.vram_gb = 6.0
    cube = trimesh.creation.box(extents=[1, 1, 1])
    hunyuan.generate.return_value = cube
    return hunyuan


def _make_mock_gsam(part_names: list[str]) -> MagicMock:
    """Mock Grounded SAM that returns full-image masks for each part."""
    gsam = MagicMock()
    gsam.name = "grounded_sam2"
    gsam.vram_gb = 4.5

    def mock_segment(image, prompts):
        h, w = 512, 512
        masks = {}
        # Divide image into horizontal strips, one per part
        strip_h = max(1, h // len(prompts))
        for i, part in enumerate(prompts):
            mask = np.zeros((h, w), dtype=bool)
            y_start = i * strip_h
            y_end = min((i + 1) * strip_h, h)
            mask[y_start:y_end, :] = True
            masks[part] = mask
        return masks

    gsam.segment.side_effect = mock_segment
    return gsam


class TestFallbackTrigger:
    """Verify fallback fires when PartCrafter returns insufficient parts."""

    @pytest.mark.asyncio
    async def test_fallback_pipeline_produces_valid_output(self) -> None:
        """Full integration: PartCrafter fails → Hunyuan + GSAM → valid output."""
        registry = _make_mock_registry()

        cache = ShapeCache(bucket_name="", memory_capacity=10)
        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
            max_points=2048,
        )

        orchestrator = PipelineOrchestrator(registry, cache, settings)

        # Mock the fallback models — inject via get_or_load
        mock_hunyuan = _make_mock_hunyuan()
        mock_gsam = _make_mock_gsam(
            ["head", "body", "front_left_leg", "front_right_leg", "rear_left_leg", "rear_right_leg"]
        )

        with (
            patch.object(
                registry,
                "get_or_load",
                side_effect=lambda name, factory: mock_hunyuan if "hunyuan" in name else mock_gsam,
            ),
            patch("app.services.pipeline.render_multiview_with_id_pass") as mock_render,
        ):
            # Create fake render results: 3 views with simple face-ID maps
            cube = trimesh.creation.box(extents=[1, 1, 1])
            n_faces = len(cube.faces)

            def fake_render(mesh, **kwargs):
                results = []
                for _ in range(3):
                    color_img = PIL.Image.new("RGB", (512, 512))
                    fid_map = np.full((512, 512), -1, dtype=np.int32)
                    # Top half of image shows some faces
                    for i in range(min(n_faces, 256)):
                        row = i // 512
                        col = i % 512
                        fid_map[row, col] = i
                    results.append((color_img, fid_map))
                return results

            mock_render.side_effect = fake_render

            request = GenerateRequest(text="horse")
            response = await orchestrator.generate(request)

        # ── Verify output ────────────────────────────────────────────────
        assert response.pipeline == "hunyuan3d_grounded_sam"
        assert response.cached is False
        assert response.generation_time_ms > 0

        # Verify positions array is base64-encoded, non-empty
        assert len(response.positions) > 0
        assert len(response.part_ids) > 0
        assert len(response.part_names) > 0
        assert response.template_type == "quadruped"

    @pytest.mark.asyncio
    async def test_partcrafter_success_skips_fallback(self) -> None:
        """When PartCrafter returns enough parts, fallback should NOT fire."""
        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
            max_points=2048,
        )
        registry = ModelRegistry(settings)

        # Mock SDXL
        sdxl = MagicMock()
        sdxl.generate.return_value = PIL.Image.new("RGB", (512, 512))
        registry.register("sdxl_turbo", sdxl)

        # Mock PartCrafter with 6 REAL meshes (all with >1 vertex)
        partcrafter = MagicMock()
        meshes = [trimesh.creation.box(extents=[0.2, 0.2, 0.2]) for _ in range(6)]
        partcrafter.generate.return_value = meshes
        registry.register("partcrafter", partcrafter)

        cache = ShapeCache(bucket_name="", memory_capacity=10)
        orchestrator = PipelineOrchestrator(registry, cache, settings)

        request = GenerateRequest(text="horse")
        response = await orchestrator.generate(request)

        assert response.pipeline == "partcrafter"


class TestRegistryUnload:
    def test_unload_removes_model(self) -> None:
        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
        )
        registry = ModelRegistry(settings)
        registry.register("test_model", MagicMock())
        assert registry.has("test_model")

        registry.unload("test_model")
        assert not registry.has("test_model")

    def test_unload_nonexistent_noop(self) -> None:
        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
        )
        registry = ModelRegistry(settings)
        registry.unload("nonexistent")  # Should not raise
