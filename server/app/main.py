# FastAPI application factory with lifespan management.
# Entrypoint: uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8080

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.auth import APIKeyMiddleware
from app.cache.shape_cache import ShapeCache
from app.config import get_settings
from app.exceptions import register_exception_handlers
from app.logging_config import configure_logging
from app.middleware import RequestContextMiddleware
from app.models.registry import ModelRegistry
from app.rate_limit import limiter
from app.routes import cache as cache_routes
from app.routes import debug, generate, health
from app.routes import prometheus as prometheus_routes
from app.services.metrics import PipelineMetrics
from app.services.pipeline import PipelineOrchestrator

logger = structlog.get_logger(__name__)


def _parse_retry_after(rate_limit: str) -> str:
    """Extract window duration from slowapi rate limit string."""
    windows = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}
    try:
        _, window = rate_limit.strip().split("/")
        return str(windows.get(window.strip(), 60))
    except (ValueError, AttributeError):
        return "60"


async def _rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Return a structured JSON 429 consistent with LumenError responses."""
    settings = get_settings()
    retry_after = _parse_retry_after(settings.rate_limit)
    logger.warning(
        "rate_limit_exceeded",
        path=request.url.path,
        method=request.method,
        detail=str(exc.detail),
    )
    return JSONResponse(
        status_code=429,
        content={"error": f"Rate limit exceeded: {exc.detail}"},
        headers={"Retry-After": retry_after},
    )


if TYPE_CHECKING:
    from opentelemetry.sdk.trace import TracerProvider


def _configure_otel(exporter_type: str) -> "TracerProvider | None":
    """Configure OpenTelemetry tracing (console or gcp)."""
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider()

    if exporter_type == "console":
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter

        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    elif exporter_type == "gcp":
        try:
            from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter

            provider.add_span_processor(BatchSpanProcessor(CloudTraceSpanExporter()))  # type: ignore[no-untyped-call]
        except ImportError:
            logger.warning("gcp_trace_exporter_not_available")
            return None
    else:
        logger.warning("unknown_otel_exporter", exporter=exporter_type)
        return None

    from opentelemetry import trace

    trace.set_tracer_provider(provider)
    logger.info("otel_configured", exporter=exporter_type)
    return provider


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage startup/shutdown. Models load in background; port binds immediately."""
    import asyncio
    import os

    settings = get_settings()

    otel_provider = None
    otel_exporter = os.environ.get("OTEL_EXPORTER", "")
    if otel_exporter:
        otel_provider = _configure_otel(otel_exporter)

    registry = ModelRegistry(settings)
    cache = ShapeCache(bucket_name=settings.cache_bucket)
    await cache.connect()
    metrics = PipelineMetrics()
    orchestrator = PipelineOrchestrator(registry, cache, settings, metrics=metrics)

    app.state.model_registry = registry
    app.state.shape_cache = cache
    app.state.settings = settings
    app.state.metrics = metrics
    app.state.pipeline_orchestrator = orchestrator

    # Load models in background (task ref stored to prevent GC cancellation)
    if not settings.skip_model_load:
        task = asyncio.create_task(_load_models_and_warm_cache(registry, cache))
        task.add_done_callback(_on_model_load_done)
        app.state._model_load_task = task

    yield

    # Flush OTel spans before shutdown (critical for Cloud Run scale-to-zero)
    if otel_provider is not None:
        otel_provider.shutdown()

    await cache.disconnect()


def _on_model_load_done(task: asyncio.Task[None]) -> None:
    """Log background model-load task failures (suppresses silent exceptions)."""
    if task.cancelled():
        logger.error("model_load_task_cancelled")
    elif exc := task.exception():
        logger.critical(
            "model_load_task_failed",
            error=str(exc),
            error_type=type(exc).__name__,
        )


async def _load_models_and_warm_cache(registry: ModelRegistry, cache: ShapeCache) -> None:
    """Load models and warm cache: GCS sync → load → cache warmup."""
    import asyncio

    from app.model_sync import sync_model_weights

    loop = asyncio.get_running_loop()
    settings = get_settings()

    if settings.model_weights_bucket:
        try:
            await loop.run_in_executor(
                None,
                sync_model_weights,
                settings.model_weights_bucket,
                settings.model_cache_dir,
            )
        except Exception:
            logger.exception("model_weight_sync_failed", hint="Falling back to HuggingFace Hub")

    try:
        logger.info("background_model_load_start")

        def _load() -> None:
            from app.models.sdxl_turbo import SDXLTurboModel

            sdxl = SDXLTurboModel(device="cuda")
            registry.register("sdxl_turbo", sdxl)

            from app.models.partcrafter import PartCrafterModel

            partcrafter = PartCrafterModel(device="cuda")
            registry.register("partcrafter", partcrafter)

            try:
                import torch

                if torch.cuda.is_available():
                    allocated = torch.cuda.memory_allocated() / 1e9
                    total = torch.cuda.get_device_properties(0).total_memory / 1e9
                    logger.info(
                        "vram_budget",
                        allocated_gb=round(allocated, 2),
                        total_gb=round(total, 2),
                        free_gb=round(total - allocated, 2),
                    )
            except ImportError:
                pass

        await loop.run_in_executor(None, _load)
        logger.info("background_model_load_complete")
    except Exception:
        logger.exception("background_model_load_failed")
        raise

    # Eager-load fallback models (optional, separate error handling)
    if settings.eager_load_all:
        try:

            def _load_fallback() -> None:
                from app.models.grounded_sam import GroundedSAM2Model
                from app.models.hunyuan3d import Hunyuan3DTurboModel

                logger.info("eager_loading_fallback_models")
                hunyuan = Hunyuan3DTurboModel(device="cuda")
                registry.register("hunyuan3d_turbo", hunyuan)

                gsam = GroundedSAM2Model(device="cuda")
                registry.register("grounded_sam2", gsam)
                logger.info("fallback_models_eager_loaded")

            await loop.run_in_executor(None, _load_fallback)
        except Exception:
            logger.exception(
                "fallback_model_eager_load_failed",
                hint="Primary models are still available. Fallback will lazy-load on demand.",
            )

    try:
        loaded = await cache.load_all_cached()
        logger.info("cache_warmed", shapes_loaded=loaded)
    except Exception:
        logger.exception("cache_warming_failed")

    # Preload top concepts in parallel (faster than sequential on cold start)
    top_concepts = ["horse", "dog", "cat", "bird", "dragon", "elephant", "fish", "car"]

    async def _preload_one(concept: str) -> bool:
        try:
            existing = await cache.get(concept)
            if existing is not None:
                return False  # Already in memory from load_all_cached
            return await cache.preload_to_memory(concept)
        except Exception:
            logger.warning("preload_concept_failed", concept=concept)
            return False

    results = await asyncio.gather(*[_preload_one(c) for c in top_concepts])
    preloaded = sum(results)
    logger.info("top_concepts_preloaded", count=preloaded, total=len(top_concepts))


def _parse_origins(allowed_origins: str) -> list[str]:
    """Parse comma-separated CORS origins. Empty string → deny all."""
    if not allowed_origins.strip():
        logger.warning(
            "cors_no_origins_configured",
            hint="Set ALLOWED_ORIGINS env var. Cross-origin requests will be rejected.",
        )
        return []
    return [origin.strip() for origin in allowed_origins.split(",") if origin.strip()]


def create_app() -> FastAPI:
    """Application factory. Invoked by: uvicorn app.main:create_app --factory"""
    settings = get_settings()
    configure_logging(log_level=settings.log_level, json_output=settings.log_json)

    app = FastAPI(
        title="Lumen Pipeline",
        description="Speech-to-3D point cloud generation server",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

    # Middleware order (Starlette applies in reverse): CORS → APIKey → RequestContext
    app.add_middleware(RequestContextMiddleware)

    api_key_value = settings.api_key.get_secret_value()
    if api_key_value:
        app.add_middleware(APIKeyMiddleware, api_key=api_key_value)
        logger.info("api_key_auth_enabled")
    else:
        logger.warning("api_key_auth_disabled", reason="API_KEY env var not set")

    origins = _parse_origins(settings.allowed_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key"],
    )

    register_exception_handlers(app)

    app.include_router(health.router, tags=["health"])
    app.include_router(generate.router, tags=["generate"])
    app.include_router(cache_routes.router, tags=["cache"])
    app.include_router(prometheus_routes.router, tags=["prometheus"])
    if settings.enable_debug_routes:
        app.include_router(debug.router, prefix="/debug", tags=["debug"])

    return app
