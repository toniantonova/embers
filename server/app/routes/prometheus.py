# ─────────────────────────────────────────────────────────────────────────────
# Prometheus Metrics Endpoint — text exposition format
# ─────────────────────────────────────────────────────────────────────────────
# GET /metrics/prometheus → text/plain Prometheus format
# Bridges PipelineMetrics → prometheus-client gauges/counters/histograms.
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

from app.dependencies import get_metrics, get_model_registry
from app.models.registry import ModelRegistry
from app.services.metrics import PipelineMetrics

router = APIRouter()

# ── Prometheus metrics (custom registry to avoid default process metrics) ─────

_registry = CollectorRegistry()

_requests_total = Counter(
    "lumen_requests_total",
    "Total requests to the generation pipeline",
    ["pipeline", "cached", "status"],
    registry=_registry,
)

_request_duration = Histogram(
    "lumen_request_duration_seconds",
    "Request duration in seconds",
    ["pipeline"],
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 15.0, 30.0),
    registry=_registry,
)

_cache_hit_ratio = Gauge(
    "lumen_cache_hit_ratio",
    "Cache hit ratio (0.0–1.0)",
    registry=_registry,
)

_gpu_memory_bytes = Gauge(
    "lumen_gpu_memory_bytes",
    "GPU memory currently allocated in bytes",
    registry=_registry,
)

_model_load_status = Gauge(
    "lumen_model_load_status",
    "Whether a model is loaded (1) or not (0)",
    ["model_name"],
    registry=_registry,
)


def _sync_metrics(metrics: PipelineMetrics, model_registry: ModelRegistry) -> None:
    """Sync PipelineMetrics data into Prometheus gauges."""
    data = metrics.to_dict()

    # Cache hit ratio
    _cache_hit_ratio.set(data["cache_hit_rate"])

    # GPU memory
    try:
        import torch

        if torch.cuda.is_available():
            _gpu_memory_bytes.set(torch.cuda.memory_allocated())
        else:
            _gpu_memory_bytes.set(0)
    except ImportError:
        _gpu_memory_bytes.set(0)

    # Model load status
    known_models = [
        "sdxl_turbo",
        "partcrafter",
        "hunyuan3d_turbo",
        "grounded_sam2",
    ]
    for model_name in known_models:
        _model_load_status.labels(model_name=model_name).set(
            1 if model_registry.has(model_name) else 0
        )


@router.get("/metrics/prometheus")
async def prometheus_metrics(
    metrics: PipelineMetrics = Depends(get_metrics),
    model_registry: ModelRegistry = Depends(get_model_registry),
) -> Response:
    """Prometheus text exposition format metrics endpoint."""
    _sync_metrics(metrics, model_registry)
    return Response(
        content=generate_latest(_registry),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
