# ─────────────────────────────────────────────────────────────────────────────
# Model Registry — loads, holds, and provides access to ML models
# ─────────────────────────────────────────────────────────────────────────────


from collections.abc import Callable
from typing import Any

import structlog

from app.config import Settings

logger = structlog.get_logger(__name__)


class ModelRegistry:
    """Manages ML model lifecycle: loading, access, and lazy initialization.

    Primary models (SDXL Turbo, PartCrafter) load eagerly via load_primary().
    Fallback models (Hunyuan3D, Grounded SAM) lazy-load via get_or_load().

    Stored in app.state during lifespan, injected via Depends().
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._models: dict[str, Any] = {}
        self._loaded_names: list[str] = []

    def load_primary(self) -> None:
        """Load primary models at startup. Called during lifespan.

        Actual model loading will be added in Prompts 03 and 04.
        """
        if self._settings.skip_model_load:
            logger.info("skip_model_load", reason="SKIP_MODEL_LOAD=true")
            return

        logger.info("primary_model_loading")
        self._log_vram()

    def register(self, name: str, model: Any) -> None:
        """Register a loaded model by name."""
        self._models[name] = model
        if name not in self._loaded_names:
            self._loaded_names.append(name)
        logger.info("model_registered", model=name)
        self._log_vram()

    def get(self, name: str) -> Any:
        """Get a loaded model by name. Raises KeyError if not loaded."""
        if name not in self._models:
            raise KeyError(f"Model '{name}' not loaded. Available: {self._loaded_names}")
        return self._models[name]

    def get_or_load(self, name: str, factory: Callable[[], Any]) -> Any:
        """Get model, or lazy-load it using the factory if not yet loaded."""
        if name not in self._models:
            logger.info("lazy_loading_model", model=name)
            model = factory()
            self.register(name, model)
        return self._models[name]

    def has(self, name: str) -> bool:
        """Check if a model is loaded."""
        return name in self._models

    @property
    def loaded_names(self) -> list[str]:
        """Names of all currently loaded models."""
        return list(self._loaded_names)

    @property
    def skip_loading(self) -> bool:
        """Whether model loading was skipped (dev/test mode)."""
        return self._settings.skip_model_load

    def unload(self, name: str) -> None:
        """Unload a model and free its VRAM.

        Deletes model reference, removes from registry, and calls
        torch.cuda.empty_cache(). Used to offload fallback models
        (Hunyuan3D, Grounded SAM) after use when VRAM > 18GB.
        """
        if name not in self._models:
            return
        del self._models[name]
        if name in self._loaded_names:
            self._loaded_names.remove(name)
        try:
            import torch

            torch.cuda.empty_cache()
        except ImportError:
            pass
        logger.info("model_unloaded", model=name)
        self._log_vram()

    def _log_vram(self) -> None:
        """Log current GPU VRAM usage if available."""
        try:
            import torch

            if torch.cuda.is_available():
                allocated = torch.cuda.memory_allocated() / 1e9
                total = torch.cuda.get_device_properties(0).total_memory / 1e9
                logger.info("gpu_vram", allocated_gb=round(allocated, 1), total_gb=round(total, 1))
        except ImportError:
            pass
