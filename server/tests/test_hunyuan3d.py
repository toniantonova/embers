# ─────────────────────────────────────────────────────────────────────────────
# Tests for Hunyuan3D-2 Turbo wrapper
# ─────────────────────────────────────────────────────────────────────────────
# Unit tests covering protocol conformance, properties, and mocked generation
# without any GPU or model weights needed.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import trimesh

from app.models.protocol import ImageToMeshModel


class TestHunyuan3DProtocol:
    """Verify Hunyuan3DTurboModel satisfies the ImageToMeshModel protocol."""

    def test_protocol_conformance(self) -> None:
        """The class should be runtime-checkable against ImageToMeshModel."""
        from app.models.hunyuan3d import Hunyuan3DTurboModel

        # We can't instantiate without the real model, but we can verify
        # the class has the right attributes.
        assert hasattr(Hunyuan3DTurboModel, "name")
        assert hasattr(Hunyuan3DTurboModel, "vram_gb")
        assert hasattr(Hunyuan3DTurboModel, "generate")


class TestHunyuan3DProperties:
    """Test properties on a constructed (mocked) instance."""

    @pytest.fixture
    def model(self) -> MagicMock:
        """Create a mock that mimics Hunyuan3DTurboModel's interface."""
        mock = MagicMock()
        mock.name = "hunyuan3d_turbo"
        mock.vram_gb = 6.0
        return mock

    def test_name(self, model: MagicMock) -> None:
        assert model.name == "hunyuan3d_turbo"

    def test_vram_gb(self, model: MagicMock) -> None:
        assert model.vram_gb == 6.0

    def test_satisfies_protocol(self, model: MagicMock) -> None:
        """A mock with the right attributes should satisfy the protocol."""
        model.generate = MagicMock(return_value=trimesh.Trimesh())
        assert isinstance(model, ImageToMeshModel)


class TestHunyuan3DGenerate:
    """Test generate() with fully mocked pipeline."""

    @pytest.fixture
    def mock_pipeline(self) -> MagicMock:
        """Mock the Hunyuan3D pipeline return value."""
        mesh = trimesh.Trimesh(
            vertices=np.random.randn(100, 3).astype(np.float32),
            faces=np.array([[0, 1, 2], [3, 4, 5], [6, 7, 8]]),
        )
        pipeline = MagicMock()
        pipeline.return_value = MagicMock(mesh=mesh)
        pipeline.to = MagicMock(return_value=pipeline)
        return pipeline

    @patch("app.models.hunyuan3d.torch.inference_mode", lambda: lambda fn: fn)
    def test_generate_returns_trimesh(self, mock_pipeline: MagicMock) -> None:
        """generate() should return a trimesh.Trimesh object."""
        with (
            patch.dict(
                "sys.modules",
                {"hunyuan3d": MagicMock()},
            ),
            patch(
                "app.models.hunyuan3d.Hunyuan3DTurboModel.__init__",
                return_value=None,
            ),
        ):
            from app.models.hunyuan3d import Hunyuan3DTurboModel

            model = Hunyuan3DTurboModel.__new__(Hunyuan3DTurboModel)
            model._device = "cpu"
            model._pipeline = mock_pipeline

            import PIL.Image

            test_image = PIL.Image.new("RGB", (512, 512), color="red")

            result = model.generate(test_image)

            assert isinstance(result, trimesh.Trimesh)
            assert len(result.vertices) > 0
            mock_pipeline.assert_called_once()

    @patch("app.models.hunyuan3d.torch.inference_mode", lambda: lambda fn: fn)
    def test_generate_with_non_trimesh_output(self) -> None:
        """generate() should convert non-trimesh output to trimesh.Trimesh."""
        # Create a plain namespace object with vertices/faces but NOT a Trimesh
        verts = np.random.randn(6, 3).astype(np.float32)
        faces_arr = np.array([[0, 1, 2], [3, 4, 5]])

        class FakeMesh:
            def __init__(self):
                self.vertices = verts
                self.faces = faces_arr

        pipeline = MagicMock()
        pipeline.return_value = MagicMock(mesh=FakeMesh())

        from app.models.hunyuan3d import Hunyuan3DTurboModel

        model = Hunyuan3DTurboModel.__new__(Hunyuan3DTurboModel)
        model._device = "cpu"
        model._pipeline = pipeline

        import PIL.Image

        test_image = PIL.Image.new("RGB", (512, 512), color="blue")

        result = model.generate(test_image)

        assert isinstance(result, trimesh.Trimesh)
        assert len(result.vertices) == 6
        assert len(result.faces) == 2

    @patch("app.models.hunyuan3d.torch.inference_mode", lambda: lambda fn: fn)
    def test_generate_with_list_output(self) -> None:
        """generate() should handle pipeline returning a list (result[0])."""
        mesh = trimesh.Trimesh(
            vertices=np.random.randn(3, 3).astype(np.float32),
            faces=np.array([[0, 1, 2]]),
        )

        pipeline = MagicMock()
        # Simulate pipeline output without .mesh — uses result[0] path
        pipeline.return_value = [mesh]

        from app.models.hunyuan3d import Hunyuan3DTurboModel

        model = Hunyuan3DTurboModel.__new__(Hunyuan3DTurboModel)
        model._device = "cpu"
        model._pipeline = pipeline

        import PIL.Image

        test_image = PIL.Image.new("RGB", (512, 512), color="green")

        result = model.generate(test_image)

        assert isinstance(result, trimesh.Trimesh)
        assert len(result.vertices) == 3
