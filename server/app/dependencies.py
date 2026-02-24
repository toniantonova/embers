# ─────────────────────────────────────────────────────────────────────────────
# Dependency Injection — FastAPI Depends() providers
# ─────────────────────────────────────────────────────────────────────────────
# State flows: lifespan creates → app.state stores → Depends() injects.
# No global variables. Every dependency is explicit in endpoint signatures.
# ─────────────────────────────────────────────────────────────────────────────


from fastapi import Request

from app.cache.shape_cache import ShapeCache
from app.config import Settings
from app.models.registry import ModelRegistry
from app.services.metrics import PipelineMetrics
from app.services.pipeline import PipelineOrchestrator


def get_model_registry(request: Request) -> ModelRegistry:
    """Inject ModelRegistry into endpoints via Depends()."""
    return request.app.state.model_registry  # type: ignore[no-any-return]


def get_cache(request: Request) -> ShapeCache:
    """Inject ShapeCache into endpoints via Depends()."""
    return request.app.state.shape_cache  # type: ignore[no-any-return]


def get_settings_dep(request: Request) -> Settings:
    """Inject Settings into endpoints via Depends()."""
    return request.app.state.settings  # type: ignore[no-any-return]


def get_metrics(request: Request) -> PipelineMetrics:
    """Inject PipelineMetrics into endpoints via Depends()."""
    return request.app.state.metrics  # type: ignore[no-any-return]


def get_pipeline_orchestrator(request: Request) -> PipelineOrchestrator:
    """Inject PipelineOrchestrator into endpoints via Depends()."""
    return request.app.state.pipeline_orchestrator  # type: ignore[no-any-return]
