# ─────────────────────────────────────────────────────────────────────────────
# Model Protocols — runtime_checkable interfaces for all model wrappers
# ─────────────────────────────────────────────────────────────────────────────
# Every ML model wrapper created in subsequent prompts (03, 04, 10)
# must satisfy one of these Protocols. This makes them mockable,
# swappable, and type-checkable at runtime.
# ─────────────────────────────────────────────────────────────────────────────

from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    import numpy as np
    import PIL.Image
    import trimesh


@runtime_checkable
class TextToImageModel(Protocol):
    """Generates an image from a text prompt (e.g., SDXL Turbo)."""

    @property
    def name(self) -> str: ...

    @property
    def vram_gb(self) -> float: ...

    def generate(self, prompt: str) -> "PIL.Image.Image": ...


@runtime_checkable
class ImageToPartsModel(Protocol):
    """Generates part meshes from a reference image (e.g., PartCrafter)."""

    @property
    def name(self) -> str: ...

    @property
    def vram_gb(self) -> float: ...

    def generate(self, image: "PIL.Image.Image", num_parts: int) -> "list[trimesh.Trimesh]": ...


@runtime_checkable
class ImageToMeshModel(Protocol):
    """Generates a single mesh from a reference image (e.g., Hunyuan3D-2 Turbo)."""

    @property
    def name(self) -> str: ...

    @property
    def vram_gb(self) -> float: ...

    def generate(self, image: "PIL.Image.Image") -> "trimesh.Trimesh": ...


@runtime_checkable
class SegmentationModel(Protocol):
    """Segments an image into labeled regions (e.g., Grounded SAM 2)."""

    @property
    def name(self) -> str: ...

    @property
    def vram_gb(self) -> float: ...

    def segment(self, image: "PIL.Image.Image", prompts: list[str]) -> "dict[str, np.ndarray]": ...
