# ─────────────────────────────────────────────────────────────────────────────
# Tests — PartCrafter model wrapper + pipeline integration
# ─────────────────────────────────────────────────────────────────────────────
# All tests mock the actual ML models (PartCrafterPipeline, BriaRMBG) to
# avoid GPU/model dependencies in CI.  The point_sampler tests use real
# trimesh objects to verify end-to-end point sampling logic.
# ─────────────────────────────────────────────────────────────────────────────

import sys
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import trimesh
from PIL import Image

from app.models.protocol import ImageToPartsModel
from app.pipeline.point_sampler import sample_from_part_meshes

# ── Fixtures ─────────────────────────────────────────────────────────────────


def _make_mock_partcrafter_pipeline():
    """Create a mock PartCrafterPipeline that returns trimesh objects."""
    mock_pipe = MagicMock()
    # Create real trimesh objects for realistic testing
    box = trimesh.creation.box(extents=[1, 1, 1])
    sphere = trimesh.creation.uv_sphere(radius=0.5, count=[16, 16])
    # PartCrafter returns .meshes attribute from the pipe call
    mock_output = MagicMock()
    mock_output.meshes = [box, sphere, box.copy()]
    mock_pipe.return_value = mock_output
    mock_pipe.device = "cpu"
    return mock_pipe


def _make_mock_rmbg():
    """Create a mock BriaRMBG model."""
    mock_rmbg = MagicMock()
    return mock_rmbg


def _create_model(mock_pipe=None, mock_rmbg=None, num_parts=3):
    """Create a PartCrafterModel with mocked internals.

    Patches out huggingface_hub.snapshot_download, the PartCrafter pipeline,
    the BriaRMBG model, and prepare_image to avoid any real downloads.
    """
    if mock_pipe is None:
        mock_pipe = _make_mock_partcrafter_pipeline()
    if mock_rmbg is None:
        mock_rmbg = _make_mock_rmbg()

    # Mock the PartCrafter source imports
    mock_src_models = MagicMock()
    mock_src_pipelines = MagicMock()
    mock_src_utils = MagicMock()

    # BriaRMBG.from_pretrained → returns our mock_rmbg
    mock_src_models.briarmbg.BriaRMBG.from_pretrained.return_value = mock_rmbg
    mock_rmbg.to.return_value = mock_rmbg
    mock_rmbg.eval.return_value = mock_rmbg

    # PartCrafterPipeline.from_pretrained → returns mock_pipe
    mock_src_pipelines.pipeline_partcrafter.PartCrafterPipeline.from_pretrained.return_value = (
        mock_pipe
    )
    mock_pipe.to.return_value = mock_pipe

    # prepare_image → returns a simple white PIL image
    mock_src_utils.image_utils.prepare_image.return_value = Image.new("RGB", (512, 512), "white")

    # Inject mocked source modules
    sys.modules["src"] = MagicMock()
    sys.modules["src.models"] = mock_src_models
    sys.modules["src.models.briarmbg"] = mock_src_models.briarmbg
    sys.modules["src.pipelines"] = mock_src_pipelines
    sys.modules["src.pipelines.pipeline_partcrafter"] = mock_src_pipelines.pipeline_partcrafter
    sys.modules["src.utils"] = mock_src_utils
    sys.modules["src.utils.image_utils"] = mock_src_utils.image_utils

    with patch("huggingface_hub.snapshot_download", return_value="/fake/weights"):
        from app.models.partcrafter import PartCrafterModel

        model = PartCrafterModel.__new__(PartCrafterModel)
        model._device = "cpu"
        model._rmbg = mock_rmbg
        model._pipe = mock_pipe

    return model, mock_pipe


# ── Protocol compliance ──────────────────────────────────────────────────────


class TestPartCrafterProtocol:
    """Verify PartCrafterModel satisfies ImageToPartsModel protocol."""

    def test_protocol_compliance(self):
        model, _ = _create_model()
        assert isinstance(model, ImageToPartsModel)

    def test_name_property(self):
        model, _ = _create_model()
        assert model.name == "partcrafter"

    def test_vram_gb_property(self):
        model, _ = _create_model()
        assert model.vram_gb == 4.0


# ── Generation tests (mocked pipeline) ──────────────────────────────────────


class TestPartCrafterGenerate:
    """Test generate() with mocked PartCrafter pipeline."""

    def test_generate_returns_trimesh_list(self):
        model, _ = _create_model()
        test_image = Image.new("RGB", (512, 512), "blue")
        result = model.generate(test_image, num_parts=3)
        assert isinstance(result, list)
        assert all(isinstance(m, trimesh.Trimesh) for m in result)

    def test_generate_returns_correct_count(self):
        model, _ = _create_model()
        test_image = Image.new("RGB", (512, 512), "blue")
        result = model.generate(test_image, num_parts=3)
        assert len(result) == 3

    def test_generate_calls_pipe_correctly(self):
        mock_pipe = _make_mock_partcrafter_pipeline()
        model, _ = _create_model(mock_pipe)
        test_image = Image.new("RGB", (512, 512), "blue")

        model.generate(test_image, num_parts=4)

        mock_pipe.assert_called_once()
        call_kwargs = mock_pipe.call_args[1]
        assert call_kwargs["attention_kwargs"] == {"num_parts": 4}
        assert call_kwargs["num_tokens"] == 1024
        assert call_kwargs["num_inference_steps"] == 50
        assert call_kwargs["guidance_scale"] == 7.0
        # Image is duplicated N times
        assert len(call_kwargs["image"]) == 4

    def test_generate_clamps_num_parts(self):
        """num_parts should be clamped to [1, 16]."""
        mock_pipe = _make_mock_partcrafter_pipeline()
        model, _ = _create_model(mock_pipe)
        test_image = Image.new("RGB", (512, 512), "blue")

        model.generate(test_image, num_parts=0)
        call_kwargs = mock_pipe.call_args[1]
        assert call_kwargs["attention_kwargs"] == {"num_parts": 1}

    def test_generate_none_mesh_replacement(self):
        """None meshes should be replaced with dummy trimeshes."""
        mock_pipe = MagicMock()
        mock_output = MagicMock()
        mock_output.meshes = [
            trimesh.creation.box(extents=[1, 1, 1]),
            None,
            trimesh.creation.box(extents=[1, 1, 1]),
            None,
        ]
        mock_pipe.return_value = mock_output
        mock_pipe.device = "cpu"

        model, _ = _create_model(mock_pipe)
        test_image = Image.new("RGB", (512, 512), "blue")
        result = model.generate(test_image, num_parts=4)

        # All 4 returned, but 2 are dummy (1 vertex)
        assert len(result) == 4
        assert all(isinstance(m, trimesh.Trimesh) for m in result)
        # Real meshes have more than 1 vertex
        real_count = sum(1 for m in result if len(m.vertices) > 1)
        assert real_count == 2

    def test_prepare_image_receives_file_path(self):
        """prepare_image should receive a string path, not a PIL Image.

        This is a regression test for the bug where prepare_image (from
        PartCrafter's vendored src.utils.image_utils) was passed a PIL Image
        directly, but internally called os.stat() which expects a path.
        The fix saves the image to a temp file and passes the path.
        """
        mock_pipe = _make_mock_partcrafter_pipeline()
        model, _ = _create_model(mock_pipe)

        # Get reference to the mocked prepare_image
        mock_prepare = sys.modules["src.utils.image_utils"].prepare_image

        test_image = Image.new("RGB", (512, 512), "red")
        model.generate(test_image, num_parts=3)

        # Verify prepare_image was called with a string path (not PIL Image)
        mock_prepare.assert_called_once()
        first_arg = mock_prepare.call_args[0][0]
        assert isinstance(first_arg, str), (
            f"prepare_image should receive a file path (str), got {type(first_arg).__name__}"
        )
        assert first_arg.endswith(".png"), f"Temp file should be a .png, got: {first_arg}"

    def test_temp_file_cleaned_up_after_generate(self):
        """Temp file created for prepare_image should be deleted after use."""
        import os as _os

        mock_pipe = _make_mock_partcrafter_pipeline()
        model, _ = _create_model(mock_pipe)
        mock_prepare = sys.modules["src.utils.image_utils"].prepare_image

        # Track the temp path from the call
        captured_paths = []
        original_return = mock_prepare.return_value

        def capture_path(path, **kwargs):
            captured_paths.append(path)
            return original_return

        mock_prepare.side_effect = capture_path

        test_image = Image.new("RGB", (512, 512), "green")
        model.generate(test_image, num_parts=3)

        assert len(captured_paths) == 1, "prepare_image should be called exactly once"
        assert not _os.path.exists(captured_paths[0]), (
            f"Temp file should be deleted after use: {captured_paths[0]}"
        )

    def test_temp_file_cleaned_up_on_prepare_image_error(self):
        """Temp file should be cleaned up even if prepare_image raises."""
        import os as _os

        mock_pipe = _make_mock_partcrafter_pipeline()
        model, _ = _create_model(mock_pipe)
        mock_prepare = sys.modules["src.utils.image_utils"].prepare_image

        captured_paths = []

        def capture_and_raise(path, **kwargs):
            captured_paths.append(path)
            raise RuntimeError("simulated prepare_image failure")

        mock_prepare.side_effect = capture_and_raise

        test_image = Image.new("RGB", (512, 512), "purple")

        with pytest.raises(RuntimeError, match="simulated"):
            model.generate(test_image, num_parts=3)

        assert len(captured_paths) == 1
        assert not _os.path.exists(captured_paths[0]), (
            f"Temp file should be deleted even on error: {captured_paths[0]}"
        )


# ── Point sampling integration ───────────────────────────────────────────────


class TestPointSamplingIntegration:
    """Test that PartCrafter output feeds correctly into sample_from_part_meshes."""

    def test_point_sampling_count(self):
        """Sampling from part meshes produces exactly 2048 points."""
        meshes = [
            trimesh.creation.box(extents=[1, 1, 1]),
            trimesh.creation.uv_sphere(radius=0.5, count=[16, 16]),
            trimesh.creation.cylinder(radius=0.3, height=1.0),
        ]
        positions, part_ids = sample_from_part_meshes(meshes, total_points=2048)
        assert positions.shape == (2048, 3)
        assert part_ids.shape == (2048,)

    def test_proportional_allocation(self):
        """Larger meshes should get more points."""
        big_mesh = trimesh.creation.box(extents=[10, 10, 10])  # 600 area
        small_mesh = trimesh.creation.box(extents=[1, 1, 1])  # 6 area

        positions, part_ids = sample_from_part_meshes([big_mesh, small_mesh], total_points=2048)

        big_count = np.sum(part_ids == 0)
        small_count = np.sum(part_ids == 1)
        # Big mesh has 100x the surface area → should get ~99% of points
        assert big_count > small_count * 10

    def test_point_ids_are_valid(self):
        """Part IDs should be valid indices into the mesh list."""
        meshes = [
            trimesh.creation.box(extents=[1, 1, 1]),
            trimesh.creation.uv_sphere(radius=0.5, count=[16, 16]),
        ]
        _, part_ids = sample_from_part_meshes(meshes, total_points=2048)
        assert np.all(part_ids < len(meshes))
        assert np.all(part_ids >= 0)

    def test_positions_are_normalized(self):
        """Positions should be within [-1, 1] after normalization."""
        meshes = [
            trimesh.creation.box(extents=[5, 5, 5]),  # Offset mesh
        ]
        positions, _ = sample_from_part_meshes(meshes, total_points=1024)
        assert np.all(positions >= -1.01)  # Small tolerance for floating point
        assert np.all(positions <= 1.01)


# ── Pipeline fallback ────────────────────────────────────────────────────────


class TestPipelineFallback:
    """Test that the pipeline falls back to mock data when models aren't loaded."""

    def test_pipeline_returns_mock_without_partcrafter(self):
        """When PartCrafter isn't registered, pipeline returns mock data."""
        from app.cache.shape_cache import ShapeCache
        from app.config import Settings
        from app.models.registry import ModelRegistry
        from app.services.pipeline import PipelineOrchestrator

        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
        )
        mock_registry = ModelRegistry(settings)
        mock_cache = MagicMock(spec=ShapeCache)
        mock_cache.is_connected = True

        orchestrator = PipelineOrchestrator(mock_registry, mock_cache, settings)

        # Call _generate_sync directly
        from app.pipeline.template_matcher import get_template

        template = get_template("horse")
        positions, part_ids, part_names, pipeline = orchestrator._generate_sync("horse", template)

        assert pipeline == "mock"
        assert positions.shape == (2048, 3)
        assert part_ids.shape == (2048,)
        assert isinstance(part_names, list)

    def test_pipeline_returns_4_tuple(self):
        """Verify _generate_sync returns (positions, part_ids, part_names, pipeline)."""
        from app.config import Settings
        from app.models.registry import ModelRegistry
        from app.services.pipeline import PipelineOrchestrator

        settings = Settings(cache_bucket="", skip_model_load=True)
        registry = ModelRegistry(settings)
        cache = MagicMock()
        cache.is_connected = True
        orchestrator = PipelineOrchestrator(registry, cache, settings)

        from app.pipeline.template_matcher import get_template

        template = get_template("cat")
        result = orchestrator._generate_sync("cat", template)

        assert len(result) == 4
        positions, part_ids, part_names, pipeline = result
        assert positions.dtype == np.float32
        assert part_ids.dtype == np.uint8
        assert isinstance(part_names, list)
        assert isinstance(pipeline, str)


# ── Debug endpoint ───────────────────────────────────────────────────────────


class TestDebugGenerateMeshEndpoint:
    """Test POST /debug/generate-mesh endpoint."""

    def test_returns_503_when_model_not_loaded(self):
        from unittest.mock import AsyncMock

        from fastapi.testclient import TestClient

        from app.cache.shape_cache import ShapeCache
        from app.config import Settings
        from app.main import create_app
        from app.models.registry import ModelRegistry

        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
            enable_debug_routes=True,
        )
        registry = ModelRegistry(settings)

        app = create_app()
        app.state.model_registry = registry
        app.state.settings = settings
        mock_cache = MagicMock(spec=ShapeCache)
        mock_cache.get = AsyncMock(return_value=None)
        mock_cache.set = AsyncMock()
        mock_cache.is_connected = True
        app.state.shape_cache = mock_cache

        client = TestClient(app)

        response = client.post(
            "/debug/generate-mesh",
            json={"text": "horse"},
        )
        assert response.status_code == 503

    def test_returns_json_when_models_loaded(self):
        from unittest.mock import AsyncMock

        from fastapi.testclient import TestClient

        from app.cache.shape_cache import ShapeCache
        from app.config import Settings
        from app.main import create_app
        from app.models.registry import ModelRegistry

        settings = Settings(
            cache_bucket="",
            skip_model_load=True,
            enable_debug_routes=True,
        )
        registry = ModelRegistry(settings)

        # Mock SDXL Turbo
        mock_sdxl = MagicMock()
        mock_sdxl.generate.return_value = Image.new("RGB", (512, 512), "blue")
        registry.register("sdxl_turbo", mock_sdxl)

        # Mock PartCrafter
        mock_partcrafter = MagicMock()
        mock_partcrafter.generate.return_value = [
            trimesh.creation.box(extents=[1, 1, 1]),
            trimesh.creation.uv_sphere(radius=0.5, count=[16, 16]),
            trimesh.creation.cylinder(radius=0.3, height=1.0),
        ]
        registry.register("partcrafter", mock_partcrafter)

        app = create_app()
        app.state.model_registry = registry
        app.state.settings = settings
        mock_cache = MagicMock(spec=ShapeCache)
        mock_cache.get = AsyncMock(return_value=None)
        mock_cache.set = AsyncMock()
        mock_cache.is_connected = True
        app.state.shape_cache = mock_cache

        client = TestClient(app)

        response = client.post(
            "/debug/generate-mesh",
            json={"text": "horse"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["text"] == "horse"
        assert data["num_parts_generated"] == 3
        assert data["num_real_parts"] == 3
        assert data["total_points"] == 2048
        assert "timing" in data
        assert "image_ms" in data["timing"]
        assert "mesh_ms" in data["timing"]
        assert "sample_ms" in data["timing"]
        assert data["positions_shape"] == [2048, 3]
        assert len(data["vertices_per_part"]) == 3


# ══════════════════════════════════════════════════════════════════════════════
# Additional coverage — encoding, registry, cache
# ══════════════════════════════════════════════════════════════════════════════


class TestEncodingRoundTrips:
    """Verify encode/decode round-trips for base64 transport."""

    def test_float32_round_trip(self):
        from app.pipeline.encoding import decode_float32, encode_float32

        original = np.random.randn(100, 3).astype(np.float32)
        encoded = encode_float32(original)
        decoded = decode_float32(encoded, shape=(-1, 3))
        np.testing.assert_array_equal(original, decoded)

    def test_uint8_round_trip(self):
        from app.pipeline.encoding import decode_uint8, encode_uint8

        original = np.arange(50, dtype=np.uint8)
        encoded = encode_uint8(original)
        decoded = decode_uint8(encoded)
        np.testing.assert_array_equal(original, decoded)

    def test_compute_bbox(self):
        from app.pipeline.encoding import compute_bbox

        positions = np.array([[0, 0, 0], [1, 2, 3], [-1, -2, -3]], dtype=np.float32)
        bbox = compute_bbox(positions)
        assert bbox["min"] == [-1.0, -2.0, -3.0]
        assert bbox["max"] == [1.0, 2.0, 3.0]


class TestModelRegistryCoverage:
    """Cover ModelRegistry methods not tested elsewhere."""

    def _make_registry(self):
        from app.config import Settings
        from app.models.registry import ModelRegistry

        settings = Settings(cache_bucket="", skip_model_load=True)
        return ModelRegistry(settings)

    def test_register_and_get(self):
        registry = self._make_registry()
        mock_model = MagicMock()
        registry.register("test_model", mock_model)
        assert registry.get("test_model") is mock_model

    def test_has_returns_false_for_unregistered(self):
        registry = self._make_registry()
        assert registry.has("nonexistent") is False

    def test_has_returns_true_after_register(self):
        registry = self._make_registry()
        registry.register("foo", MagicMock())
        assert registry.has("foo") is True

    def test_get_raises_keyerror_for_missing(self):
        registry = self._make_registry()
        with pytest.raises(KeyError, match="not loaded"):
            registry.get("missing_model")

    def test_get_or_load_calls_factory_once(self):
        registry = self._make_registry()
        factory = MagicMock(return_value="loaded_model")
        result1 = registry.get_or_load("lazy", factory)
        result2 = registry.get_or_load("lazy", factory)
        assert result1 == "loaded_model"
        assert result2 == "loaded_model"
        factory.assert_called_once()

    def test_loaded_names(self):
        registry = self._make_registry()
        registry.register("a", MagicMock())
        registry.register("b", MagicMock())
        assert set(registry.loaded_names) == {"a", "b"}


class TestShapeCacheCoverage:
    """Cover ShapeCache helpers not tested elsewhere."""

    def test_normalize_key_lowercases(self):
        from app.cache.shape_cache import ShapeCache

        assert ShapeCache.normalize_key("HORSE") == "horse"

    def test_normalize_key_strips_articles(self):
        from app.cache.shape_cache import ShapeCache

        assert ShapeCache.normalize_key("a big horse") == "big horse"
        assert ShapeCache.normalize_key("the cat") == "cat"
        assert ShapeCache.normalize_key("an apple") == "apple"

    def test_normalize_key_strips_punctuation(self):
        from app.cache.shape_cache import ShapeCache

        assert ShapeCache.normalize_key("hello, world!") == "hello world"

    def test_hash_key_deterministic(self):
        from app.cache.shape_cache import ShapeCache

        h1 = ShapeCache._hash_key("horse")
        h2 = ShapeCache._hash_key("horse")
        assert h1 == h2
        assert len(h1) == 16

    def test_hash_key_different_inputs(self):
        from app.cache.shape_cache import ShapeCache

        h1 = ShapeCache._hash_key("horse")
        h2 = ShapeCache._hash_key("cat")
        assert h1 != h2

    def test_memory_only_mode(self):
        """Cache with no bucket name should still work (memory-only)."""
        from app.cache.shape_cache import ShapeCache

        cache = ShapeCache(bucket_name="", memory_capacity=10)
        assert cache.is_connected is True

    @pytest.mark.asyncio
    async def test_stats_initially_zero(self):
        from app.cache.shape_cache import ShapeCache

        cache = ShapeCache(bucket_name="", memory_capacity=10)
        stats = await cache.stats()
        assert stats["memory_hits"] == 0
        assert stats["storage_hits"] == 0
        assert stats["misses"] == 0
        assert stats["hit_rate"] == 0
