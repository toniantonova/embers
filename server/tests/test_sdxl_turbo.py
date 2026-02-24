# ─────────────────────────────────────────────────────────────────────────────
# Tests — SDXLTurboModel + debug image endpoint
# ─────────────────────────────────────────────────────────────────────────────
# All tests mock the actual model pipeline — no GPU required.
#
# Because torch/diffusers may not be installed in the test environment,
# we mock them at the sys.modules level before importing SDXLTurboModel.
# ─────────────────────────────────────────────────────────────────────────────

import sys
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from app.models.protocol import TextToImageModel
from app.pipeline.prompt_templates import get_canonical_prompt
from app.pipeline.template_matcher import get_template

# ── Module-level mocks for GPU-only dependencies ────────────────────────────
# torch and diffusers may not be installed locally, so we inject mocks
# into sys.modules before importing the SUT.


def _install_mock_modules():
    """Inject mock torch + diffusers into sys.modules if missing."""
    mods = {}

    if "torch" not in sys.modules:
        mock_torch = MagicMock()
        mock_torch.float16 = "float16"
        mock_torch.inference_mode.return_value = lambda fn: fn  # passthrough decorator
        mock_torch.cuda.is_available.return_value = False
        mock_torch.cuda.memory_allocated.return_value = 0

        mods["torch"] = mock_torch
        mods["torch.cuda"] = mock_torch.cuda

    if "diffusers" not in sys.modules:
        mock_diffusers = MagicMock()
        mods["diffusers"] = mock_diffusers

    sys.modules.update(mods)
    return mods


_installed = _install_mock_modules()


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_mock_pipeline():
    """Create a mock diffusers pipeline that returns a 512×512 image."""
    mock_pipe = MagicMock()
    mock_result = MagicMock()
    mock_result.images = [Image.new("RGB", (512, 512), color="red")]
    mock_pipe.return_value = mock_result
    mock_pipe.to = MagicMock(return_value=mock_pipe)
    mock_pipe.set_progress_bar_config = MagicMock()
    return mock_pipe


def _create_model(mock_pipe=None):
    """Instantiate SDXLTurboModel with a mocked diffusers pipeline."""
    if mock_pipe is None:
        mock_pipe = _make_mock_pipeline()

    with patch("app.models.sdxl_turbo.StableDiffusionXLPipeline") as MockPipeline:
        MockPipeline.from_pretrained.return_value = mock_pipe

        from app.models.sdxl_turbo import SDXLTurboModel

        model = SDXLTurboModel(device="cpu")
    return model, mock_pipe


# ── Protocol compliance ─────────────────────────────────────────────────────


class TestSDXLTurboProtocol:
    """Verify SDXLTurboModel satisfies TextToImageModel protocol."""

    def test_protocol_compliance(self):
        model, _ = _create_model()
        assert isinstance(model, TextToImageModel)

    def test_name_property(self):
        model, _ = _create_model()
        assert model.name == "sdxl_turbo"

    def test_vram_gb_property(self):
        model, _ = _create_model()
        assert model.vram_gb == 3.0


# ── Image generation ────────────────────────────────────────────────────────


class TestSDXLTurboGenerate:
    """Verify generate() returns correct images and passes correct args."""

    def test_generate_returns_pil_image(self):
        model, _ = _create_model()
        result = model.generate("a 3D render of a horse")
        assert isinstance(result, Image.Image)

    def test_generate_image_size(self):
        model, _ = _create_model()
        result = model.generate("a 3D render of a horse")
        assert result.size == (512, 512)

    def test_generate_passes_correct_args(self):
        mock_pipe = _make_mock_pipeline()
        model, _ = _create_model(mock_pipe)

        model.generate("a test prompt", num_steps=4, guidance_scale=0.0)

        mock_pipe.assert_called_once_with(
            prompt="a test prompt",
            num_inference_steps=4,
            guidance_scale=0.0,
            width=512,
            height=512,
        )

    def test_generate_custom_steps(self):
        mock_pipe = _make_mock_pipeline()
        model, _ = _create_model(mock_pipe)

        model.generate("test", num_steps=1, guidance_scale=0.0)

        call_kwargs = mock_pipe.call_args.kwargs
        assert call_kwargs["num_inference_steps"] == 1

    def test_generate_oom_clears_cache_and_reraises(self):
        """OOM handler should call torch.cuda.empty_cache() then re-raise."""
        mock_pipe = _make_mock_pipeline()
        # Simulate CUDA OOM
        oom_error = type("OutOfMemoryError", (RuntimeError,), {})("CUDA out of memory")

        mock_torch = sys.modules["torch"]
        mock_torch.cuda.OutOfMemoryError = type(oom_error)
        mock_pipe.side_effect = oom_error

        model, _ = _create_model(mock_pipe)

        # Explicitly patch empty_cache with a trackable MagicMock
        mock_empty_cache = MagicMock()
        with patch.object(mock_torch.cuda, "empty_cache", mock_empty_cache):
            with pytest.raises(type(oom_error)):
                model.generate("a test prompt")

            mock_empty_cache.assert_called_once()


# ── Prompt integration ──────────────────────────────────────────────────────


class TestSDXLPromptIntegration:
    """Verify canonical prompts from prompt_templates are well-formed."""

    def test_canonical_prompt_for_known_noun(self):
        template = get_template("horse")
        prompt = get_canonical_prompt("horse", template.template_type)

        assert "horse" in prompt
        assert "3D render" in prompt
        # Quadruped suffix
        assert "four legs visible" in prompt

    def test_canonical_prompt_for_unknown_noun(self):
        template = get_template("xylophone")
        prompt = get_canonical_prompt("xylophone", template.template_type)

        assert "xylophone" in prompt
        assert "3D render" in prompt

    def test_generate_with_canonical_prompt(self):
        mock_pipe = _make_mock_pipeline()
        model, _ = _create_model(mock_pipe)

        template = get_template("eagle")
        prompt = get_canonical_prompt("eagle", template.template_type)
        model.generate(prompt)

        call_kwargs = mock_pipe.call_args.kwargs
        assert "eagle" in call_kwargs["prompt"]
        assert "3D render" in call_kwargs["prompt"]


# ── Debug endpoint ──────────────────────────────────────────────────────────


class TestDebugGenerateImageEndpoint:
    """Test the POST /debug/generate-image endpoint."""

    def test_returns_503_when_model_not_loaded(self, client):
        """Should return 503 via ModelNotLoadedError when SDXL Turbo is not loaded."""
        response = client.post(
            "/debug/generate-image",
            json={"text": "horse"},
        )
        assert response.status_code == 503
        assert "not loaded" in response.json()["error"]

    def test_returns_png_when_model_loaded(self, client, mock_registry):
        """Should return PNG image when SDXL Turbo is registered."""
        mock_sdxl = MagicMock()
        mock_sdxl.generate.return_value = Image.new("RGB", (512, 512), "blue")
        mock_registry.register("sdxl_turbo", mock_sdxl)

        response = client.post(
            "/debug/generate-image",
            json={"text": "horse"},
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert len(response.content) > 0

        # Verify the model was called with a canonical prompt
        mock_sdxl.generate.assert_called_once()
        prompt_arg = mock_sdxl.generate.call_args[0][0]
        assert "horse" in prompt_arg


# ── Pipeline fallback ───────────────────────────────────────────────────────


class TestPipelineFallback:
    """Verify pipeline falls back to mock when SDXL not registered."""

    @pytest.mark.asyncio
    async def test_pipeline_returns_mock_without_sdxl(self):
        from unittest.mock import AsyncMock

        from app.config import Settings
        from app.models.registry import ModelRegistry
        from app.schemas import GenerateRequest
        from app.services.pipeline import PipelineOrchestrator

        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
            max_points=256,
        )
        registry = ModelRegistry(settings)
        cache = MagicMock()
        cache.get = AsyncMock(return_value=None)
        cache.set = AsyncMock()

        orchestrator = PipelineOrchestrator(registry, cache, settings)
        result = await orchestrator.generate(GenerateRequest(text="horse"))

        assert result.pipeline == "mock"
