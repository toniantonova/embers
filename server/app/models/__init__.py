"""Model wrappers — Protocol interfaces and ModelRegistry."""

from app.models.protocol import (
    ImageToMeshModel,
    ImageToPartsModel,
    SegmentationModel,
    TextToImageModel,
)
from app.models.registry import ModelRegistry

__all__ = [
    "ImageToMeshModel",
    "ImageToPartsModel",
    "ModelRegistry",
    "SegmentationModel",
    "TextToImageModel",
]
