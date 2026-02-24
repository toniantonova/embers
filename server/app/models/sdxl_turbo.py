# ─────────────────────────────────────────────────────────────────────────────
# SDXL Turbo Model Wrapper — Text → Image (512×512)
# ─────────────────────────────────────────────────────────────────────────────
# Implements the TextToImageModel protocol from models/protocol.py.
#
# Uses Stability AI's SDXL Turbo (stabilityai/sdxl-turbo), a distilled
# latent consistency model that generates images in 1-4 inference steps.
# Guidance scale is 0.0 — the model is distilled and does NOT use
# classifier-free guidance.
#
# VRAM: ~3 GB in float16 on NVIDIA RTX Pro 6000 (96 GB total)
# Speed: ~1 second per 512×512 image at 4 steps
# ─────────────────────────────────────────────────────────────────────────────

import time

import PIL.Image
import structlog
import torch
from diffusers import StableDiffusionXLPipeline

logger = structlog.get_logger(__name__)

# ── Defaults ────────────────────────────────────────────────────────────────
_MODEL_ID = "stabilityai/sdxl-turbo"
_DEFAULT_STEPS = 4
_DEFAULT_GUIDANCE = 0.0  # Distilled model — no CFG needed
_OUTPUT_SIZE = 512


class SDXLTurboModel:
    """SDXL Turbo wrapper for single-image text-to-image generation.

    Satisfies the ``TextToImageModel`` protocol defined in
    ``app.models.protocol``.  Generates 512×512 RGB images in 1-4
    denoising steps (~1 s on an RTX Pro 6000 GPU in float16).

    The generated image is intended as a *canonical reference* that
    downstream mesh generators (PartCrafter / Hunyuan3D) consume to
    produce 3-D geometry.
    """

    # ── Construction ────────────────────────────────────────────────────────

    def __init__(self, device: str = "cuda") -> None:
        """Load SDXL Turbo from HuggingFace Hub.

        Weights are cached under ``$HF_HOME`` (set in the Dockerfile to
        ``/home/appuser/models``).  First invocation downloads ~6 GB;
        subsequent starts load from disk.
        """
        self._device = device
        logger.info("sdxl_turbo_loading", model_id=_MODEL_ID, device=device)
        t0 = time.perf_counter()

        self._pipe = StableDiffusionXLPipeline.from_pretrained(  # type: ignore[no-untyped-call]
            _MODEL_ID,
            torch_dtype=torch.float16,
            variant="fp16",
        ).to(device)

        # No progress bars in production logging
        self._pipe.set_progress_bar_config(disable=True)

        elapsed = time.perf_counter() - t0
        vram_used = torch.cuda.memory_allocated(device) / 1e9 if torch.cuda.is_available() else 0.0
        logger.info(
            "sdxl_turbo_loaded",
            load_time_s=round(elapsed, 2),
            vram_gb=round(vram_used, 2),
        )

    # ── Protocol properties ─────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "sdxl_turbo"

    @property
    def vram_gb(self) -> float:
        return 3.0

    # ── Inference ───────────────────────────────────────────────────────────

    @torch.inference_mode()
    def generate(
        self,
        prompt: str,
        *,
        num_steps: int = _DEFAULT_STEPS,
        guidance_scale: float = _DEFAULT_GUIDANCE,
    ) -> PIL.Image.Image:
        """Generate a single 512×512 RGB image from a text prompt.

        Args:
            prompt: Canonical prompt (from ``prompt_templates.py``).
            num_steps: Denoising steps (1-4). More = higher quality.
            guidance_scale: Classifier-free guidance weight.
                SDXL Turbo is distilled — always use 0.0.

        Returns:
            A 512×512 RGB ``PIL.Image.Image``.
        """
        t0 = time.perf_counter()

        try:
            result = self._pipe(
                prompt=prompt,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
                width=_OUTPUT_SIZE,
                height=_OUTPUT_SIZE,
            )
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            logger.error("sdxl_turbo_oom", prompt_len=len(prompt), steps=num_steps)
            raise

        image: PIL.Image.Image = result.images[0]
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        logger.info(
            "sdxl_turbo_generated",
            prompt_len=len(prompt),
            steps=num_steps,
            size=f"{image.width}x{image.height}",
            time_ms=elapsed_ms,
        )
        return image
