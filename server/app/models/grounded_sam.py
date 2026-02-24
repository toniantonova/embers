# ─────────────────────────────────────────────────────────────────────────────
# Grounded SAM 2 — text-prompted image segmentation
# ─────────────────────────────────────────────────────────────────────────────
# Implements SegmentationModel protocol.
# Combines GroundingDINO (text→box) + SAM2 (box→mask).
# Lazy-loaded via ModelRegistry.get_or_load() on first fallback trigger.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import numpy as np
import PIL.Image
import structlog
import torch

logger = structlog.get_logger(__name__)


def _part_name_to_prompt(part_name: str) -> str:
    """Transform programmer-facing part names to natural language prompts.

    GroundingDINO is sensitive to prompt phrasing — terse identifiers like
    'front_left_leg' detect poorly. Natural language works much better.

    Examples:
        'front_left_leg' → 'the front left leg'
        'body'           → 'the body'
        'head'           → 'the head'
    """
    # Replace underscores with spaces
    text = part_name.replace("_", " ").strip()
    # Prepend article if not already present
    if not text.startswith(("the ", "a ", "an ")):
        text = f"the {text}"
    return text


class GroundedSAM2Model:
    """Grounded SAM 2: GroundingDINO + SAM2 for text-prompted segmentation.

    Takes a rendered image + text prompts for each part name.
    Returns pixel-level masks per part.
    ~0.3-0.5s for 6 part prompts, ~4-6GB VRAM.
    """

    def __init__(self, device: str = "cuda") -> None:
        """Load GroundingDINO + SAM2.

        Only called on first fallback trigger via ModelRegistry.get_or_load().
        """
        logger.info("grounded_sam2_loading")
        self._device = device

        # Import here to avoid loading at module level
        from groundingdino.util.inference import (  # type: ignore[import-not-found]
            load_model as load_gdino,
        )
        from sam2.build_sam import build_sam2  # type: ignore[import-not-found]
        from sam2.sam2_image_predictor import (  # type: ignore[import-not-found]
            SAM2ImagePredictor,
        )

        # GroundingDINO
        self._gdino = load_gdino(
            "groundingdino_swint_ogc",
            device=device,
        )

        # SAM2
        sam2 = build_sam2(
            "sam2_hiera_large",
            device=device,
        )
        self._sam_predictor = SAM2ImagePredictor(sam2)

        logger.info("grounded_sam2_loaded", device=device)

    @property
    def name(self) -> str:
        return "grounded_sam2"

    @property
    def vram_gb(self) -> float:
        return 4.5

    @torch.inference_mode()
    def segment(self, image: PIL.Image.Image, prompts: list[str]) -> dict[str, np.ndarray]:
        """Segment image into parts using text prompts.

        Args:
            image: Rendered view of the mesh (PIL Image).
            prompts: Part names like ["head", "body", "front_left_leg"].

        Returns:
            Dict mapping part name → binary mask (H, W) as numpy bool array.
        """
        import time

        from groundingdino.util.inference import predict as gdino_predict

        t0 = time.perf_counter()
        image_np = np.array(image)
        self._sam_predictor.set_image(image_np)

        masks: dict[str, np.ndarray] = {}

        for part_name in prompts:
            text_prompt = _part_name_to_prompt(part_name)
            logger.debug(
                "gsam_prompt",
                raw=part_name,
                transformed=text_prompt,
            )

            # GroundingDINO: text → bounding boxes
            boxes, logits, phrases = gdino_predict(
                model=self._gdino,
                image=image,
                caption=text_prompt,
                box_threshold=0.25,
                text_threshold=0.25,
            )

            if len(boxes) == 0:
                logger.debug("gsam_no_detection", part=part_name)
                continue

            # Take highest-confidence box
            best_idx = logits.argmax()
            box = boxes[best_idx].unsqueeze(0)

            # SAM2: box → mask
            sam_masks, scores, _ = self._sam_predictor.predict(
                box=box.cpu().numpy(),
                multimask_output=False,
            )

            if sam_masks is not None and len(sam_masks) > 0:
                masks[part_name] = sam_masks[0].astype(bool)

        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.info(
            "grounded_sam2_segmented",
            parts_requested=len(prompts),
            parts_found=len(masks),
            time_ms=elapsed_ms,
        )

        return masks
