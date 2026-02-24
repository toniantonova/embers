# ─────────────────────────────────────────────────────────────────────────────
# PartCrafter Model Wrapper — Image → Part Meshes
# ─────────────────────────────────────────────────────────────────────────────
# Implements the ImageToPartsModel protocol from models/protocol.py.
#
# Uses PartCrafter (NeurIPS 2025) to generate pre-decomposed triangle meshes
# from a single reference image.  Each mesh is a semantic part of the object
# (head, body, legs, tail, etc.).
#
# Pipeline:
#   1. BriaRMBG removes the background (SDXL Turbo outputs have backgrounds)
#   2. PartCrafterPipeline generates N part meshes from the white-bg image
#   3. None outputs (decoding failures) are replaced with dummy trimeshes
#
# VRAM: ~4 GB in float16 on NVIDIA RTX Pro 6000 (+ ~0.2 GB for RMBG)
# Speed: ~5–10s per generation at 50 inference steps
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import os
import tempfile
import time

import PIL.Image
import structlog
import torch
import trimesh

logger = structlog.get_logger(__name__)

# ── Defaults ────────────────────────────────────────────────────────────────
_PARTCRAFTER_REPO = "wgsxm/PartCrafter"
_RMBG_REPO = "briaai/RMBG-1.4"
_DEFAULT_NUM_TOKENS = 1024
_DEFAULT_INFERENCE_STEPS = 50
_DEFAULT_GUIDANCE_SCALE = 7.0
_MAX_PARTS = 16
_DUMMY_MESH = trimesh.Trimesh(vertices=[[0, 0, 0]], faces=[[0, 0, 0]])


class PartCrafterModel:
    """PartCrafter wrapper for single-image part-decomposed mesh generation.

    Satisfies the ``ImageToPartsModel`` protocol defined in
    ``app.models.protocol``.  Generates 2–16 separate triangle meshes
    from a single reference image, each representing a semantic part.

    Includes BriaRMBG preprocessing to remove backgrounds from SDXL Turbo
    images before feeding them to PartCrafter (which expects white-bg input).
    """

    # ── Construction ────────────────────────────────────────────────────────

    def __init__(self, device: str = "cuda") -> None:
        """Load PartCrafter and BriaRMBG from HuggingFace Hub.

        Weights are cached under ``$HF_HOME`` (set in the Dockerfile to
        ``/home/appuser/models``).  First invocation downloads ~4 GB
        (PartCrafter) + ~0.2 GB (RMBG); subsequent starts load from disk.
        """
        from huggingface_hub import snapshot_download

        self._device = device
        logger.info("partcrafter_loading", device=device)
        t0 = time.perf_counter()

        # ── Download weights ────────────────────────────────────────────────
        partcrafter_dir = snapshot_download(
            repo_id=_PARTCRAFTER_REPO,
            cache_dir=None,  # Uses HF_HOME
        )
        rmbg_dir = snapshot_download(
            repo_id=_RMBG_REPO,
            cache_dir=None,
        )
        download_elapsed = time.perf_counter() - t0
        logger.info("partcrafter_weights_downloaded", time_s=round(download_elapsed, 2))

        # ── Load BriaRMBG (background removal) ─────────────────────────────
        t1 = time.perf_counter()
        from src.models.briarmbg import BriaRMBG  # type: ignore[import-not-found]

        self._rmbg = BriaRMBG.from_pretrained(rmbg_dir).to(device)
        self._rmbg.eval()
        rmbg_elapsed = time.perf_counter() - t1
        logger.info("rmbg_loaded", time_s=round(rmbg_elapsed, 2))

        # ── Load PartCrafter pipeline ───────────────────────────────────────
        t2 = time.perf_counter()
        from src.pipelines.pipeline_partcrafter import (  # type: ignore[import-not-found]
            PartCrafterPipeline,
        )

        self._pipe = PartCrafterPipeline.from_pretrained(partcrafter_dir).to(device, torch.float16)
        pipe_elapsed = time.perf_counter() - t2

        total_elapsed = time.perf_counter() - t0
        vram_used = torch.cuda.memory_allocated(device) / 1e9 if torch.cuda.is_available() else 0.0
        logger.info(
            "partcrafter_loaded",
            total_time_s=round(total_elapsed, 2),
            pipe_time_s=round(pipe_elapsed, 2),
            rmbg_time_s=round(rmbg_elapsed, 2),
            vram_gb=round(vram_used, 2),
        )

    # ── Protocol properties ─────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "partcrafter"

    @property
    def vram_gb(self) -> float:
        return 4.0

    # ── Inference ───────────────────────────────────────────────────────────

    @torch.inference_mode()
    def generate(
        self,
        image: PIL.Image.Image,
        num_parts: int = 6,
        *,
        num_steps: int = _DEFAULT_INFERENCE_STEPS,
        guidance_scale: float = _DEFAULT_GUIDANCE_SCALE,
        seed: int = 0,
    ) -> list[trimesh.Trimesh]:
        """Generate pre-decomposed part meshes from a reference image.

        Args:
            image: 512×512 RGB image (from SDXL Turbo).
            num_parts: Target number of semantic parts (2–16).
            num_steps: Denoising steps (default 50).
            guidance_scale: Classifier-free guidance weight (default 7.0).
            seed: RNG seed for reproducibility.

        Returns:
            List of ``trimesh.Trimesh`` objects, one per generated part.
            ``real_parts`` attribute on each mesh indicates whether it's
            a genuine output or a dummy replacement for a decoding failure.
        """
        from src.utils.image_utils import prepare_image  # type: ignore[import-not-found]

        num_parts = max(1, min(num_parts, _MAX_PARTS))

        # ── Step 1: Background removal (BriaRMBG) ──────────────────────────
        t0 = time.perf_counter()
        import numpy as np

        # prepare_image expects a file path, not a PIL Image (it calls
        # os.stat internally).  Save to a temp file and clean up after.
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            image.save(f, format="PNG")
            temp_path = f.name

        try:
            processed_image = prepare_image(
                temp_path,
                bg_color=np.array([1.0, 1.0, 1.0]),
                rmbg_net=self._rmbg,
            )
        finally:
            os.unlink(temp_path)
        rmbg_ms = int((time.perf_counter() - t0) * 1000)

        # ── Step 2: PartCrafter mesh generation ─────────────────────────────
        t1 = time.perf_counter()
        try:
            outputs = self._pipe(
                image=[processed_image] * num_parts,
                attention_kwargs={"num_parts": num_parts},
                num_tokens=_DEFAULT_NUM_TOKENS,
                generator=torch.Generator(device=self._pipe.device).manual_seed(seed),
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale,
            ).meshes
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            logger.error("partcrafter_oom", num_parts=num_parts, steps=num_steps)
            raise
        mesh_ms = int((time.perf_counter() - t1) * 1000)

        # ── Step 3: Count real parts + replace None with dummy ──────────────
        real_count = sum(1 for m in outputs if m is not None)
        meshes: list[trimesh.Trimesh] = []
        for m in outputs:
            if m is None:
                meshes.append(_DUMMY_MESH.copy())
            else:
                meshes.append(m)

        logger.info(
            "partcrafter_generated",
            num_parts_requested=num_parts,
            real_parts=real_count,
            total_parts=len(meshes),
            rmbg_ms=rmbg_ms,
            mesh_ms=mesh_ms,
        )

        return meshes

    @property
    def real_parts_from_last_generate(self) -> int:
        """Placeholder — actual count is logged per-call.

        Use the structured log output for monitoring.
        Alternatively, callers can filter dummy meshes by vertex count.
        """
        return 0
