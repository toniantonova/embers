# ─────────────────────────────────────────────────────────────────────────────
# Hunyuan3D-2 Turbo — monolithic mesh from a single image
# ─────────────────────────────────────────────────────────────────────────────
# Implements ImageToMeshModel protocol.
# Uses FlashVDM distillation for fast inference (3 diffusion steps).
# Lazy-loaded via ModelRegistry.get_or_load() on first fallback trigger.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import PIL.Image
import structlog
import torch
import trimesh

logger = structlog.get_logger(__name__)


class Hunyuan3DTurboModel:
    """Hunyuan3D-2 Turbo with FlashVDM distillation.

    Generates a monolithic triangle mesh from a single reference image.
    FlashVDM reduces diffusion steps from 50+ to 3.
    ~1-3s generation, ~6GB VRAM.
    """

    def __init__(self, device: str = "cuda") -> None:
        """Load model weights from tencent/Hunyuan3D-2.

        Only called on first fallback trigger via ModelRegistry.get_or_load().
        """
        logger.info("hunyuan3d_loading")
        self._device = device

        # Import here to avoid loading at module level
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline  # type: ignore[import-not-found]

        self._pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            "tencent/Hunyuan3D-2",
            torch_dtype=torch.float16,
            use_flashvdm=True,
        )
        self._pipeline.to(device)

        logger.info("hunyuan3d_loaded", device=device)

    @property
    def name(self) -> str:
        return "hunyuan3d_turbo"

    @property
    def vram_gb(self) -> float:
        return 6.0

    @torch.inference_mode()
    def generate(self, image: PIL.Image.Image) -> trimesh.Trimesh:
        """Generate a single mesh from a reference image.

        Args:
            image: SDXL-generated reference image (512×512).

        Returns:
            trimesh.Trimesh with vertices and faces.
        """
        import time

        t0 = time.perf_counter()

        result = self._pipeline(
            image=image,
            num_inference_steps=3,  # FlashVDM turbo
        )

        # Extract mesh from pipeline output
        mesh = result.mesh if hasattr(result, "mesh") else result[0]

        # Ensure it's a trimesh object
        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(
                vertices=mesh.vertices,
                faces=mesh.faces,
            )

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.info(
            "hunyuan3d_generated",
            vertices=len(mesh.vertices),
            faces=len(mesh.faces),
            time_ms=elapsed_ms,
        )

        return mesh
