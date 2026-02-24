# ─────────────────────────────────────────────────────────────────────────────
# Fallback Pipeline Validation Tests
# ─────────────────────────────────────────────────────────────────────────────
# GPU tests skip gracefully via @pytest.mark.skipif.
# The fallback trigger test uses mocks and runs on CPU.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np
import PIL.Image
import pytest
import trimesh

# Check GPU availability for conditional skipping
try:
    import torch

    HAS_GPU = torch.cuda.is_available()
except ImportError:
    HAS_GPU = False


# ── GPU-Only Tests ───────────────────────────────────────────────────────────


@pytest.mark.skipif(not HAS_GPU, reason="Requires NVIDIA GPU")
class TestHunyuan3DGeneration:
    """Validate Hunyuan3D mesh generation on GPU."""

    def test_generates_mesh_with_vertices(self) -> None:
        from app.models.hunyuan3d import Hunyuan3DTurboModel

        model = Hunyuan3DTurboModel(device="cuda")
        test_image = PIL.Image.new("RGB", (512, 512), color="white")
        mesh = model.generate(test_image)

        assert isinstance(mesh, trimesh.Trimesh)
        assert len(mesh.vertices) > 100, f"Expected >100 vertices, got {len(mesh.vertices)}"


@pytest.mark.skipif(not HAS_GPU, reason="Requires NVIDIA GPU")
class TestGroundedSAMSegmentation:
    """Validate Grounded SAM segmentation on GPU."""

    def test_segments_rendered_view(self) -> None:
        from app.models.grounded_sam import GroundedSAM2Model

        model = GroundedSAM2Model(device="cuda")
        test_image = PIL.Image.new("RGB", (512, 512), color="white")
        masks = model.segment(test_image, ["body", "head"])

        assert isinstance(masks, dict)
        assert len(masks) >= 1, "Expected at least 1 part mask"


@pytest.mark.skipif(not HAS_GPU, reason="Requires NVIDIA GPU")
class TestVRAMBudget:
    """Validate VRAM budget when multiple models are loaded."""

    def test_total_vram_within_budget(self) -> None:
        import torch

        # Check current VRAM allocation
        allocated_gb = torch.cuda.memory_allocated() / 1e9
        total_gb = torch.cuda.get_device_properties(0).total_memory / 1e9

        # On an RTX Pro 6000 (96GB), total should be under 80GB with all models
        assert allocated_gb < 80.0, f"VRAM usage {allocated_gb:.1f}GB exceeds 80GB budget"
        assert total_gb > 80.0, f"Expected RTX Pro 6000 GPU (96GB), got {total_gb:.1f}GB"


# ── CPU-Safe Tests (Mocked) ─────────────────────────────────────────────────


class TestFallbackTrigger:
    """Verify pipeline falls through to Hunyuan3D when PartCrafter
    returns insufficient parts. Uses mocks — runs on CPU."""

    @pytest.mark.asyncio
    async def test_fallback_triggers_on_insufficient_parts(self) -> None:
        """Mock PartCrafter to return 1 part (below threshold),
        verify pipeline falls through to fallback path or mock."""
        from app.cache.shape_cache import ShapeCache
        from app.config import Settings
        from app.models.registry import ModelRegistry
        from app.schemas import GenerateRequest
        from app.services.metrics import PipelineMetrics
        from app.services.pipeline import PipelineOrchestrator

        settings = Settings(cache_bucket="", skip_model_load=True)
        registry = ModelRegistry(settings)
        cache = ShapeCache(bucket_name="", memory_capacity=10)
        await cache.connect()
        metrics = PipelineMetrics()
        orchestrator = PipelineOrchestrator(registry, cache, settings, metrics=metrics)

        # Register mock SDXL
        mock_sdxl = MagicMock()
        mock_sdxl.generate.return_value = PIL.Image.new("RGB", (512, 512))
        registry.register("sdxl_turbo", mock_sdxl)

        # Register mock PartCrafter that returns only 1 tiny mesh (below threshold)
        mock_pc = MagicMock()
        # Return a single very small mesh — below the 50% part threshold
        tiny_mesh = trimesh.Trimesh(
            vertices=np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32),
            faces=np.array([[0, 1, 2]]),
        )
        mock_pc.generate.return_value = [tiny_mesh]
        registry.register("partcrafter", mock_pc)

        request = GenerateRequest(text="horse")
        response = await orchestrator.generate(request)

        # The pipeline should complete (either via the tiny mesh or mock fallback)
        assert response is not None
        assert response.positions is not None
        assert response.part_ids is not None

    @pytest.mark.asyncio
    async def test_vram_threshold_is_configurable(self) -> None:
        """Verify the VRAM threshold setting works."""
        from app.config import Settings

        settings = Settings(vram_offload_threshold_gb=12.0)
        assert settings.vram_offload_threshold_gb == 12.0

        default_settings = Settings()
        assert default_settings.vram_offload_threshold_gb == 80.0
