# ─────────────────────────────────────────────────────────────────────────────
# Integration tests — full request flow with mocked models
# ─────────────────────────────────────────────────────────────────────────────
# Manually initializes app.state (ASGITransport doesn't run lifespan).
# All GPU models are mocked via skip_model_load=True.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import os
from unittest.mock import MagicMock

import PIL.Image
import pytest
import trimesh
from httpx import ASGITransport, AsyncClient

# Set env BEFORE importing app modules
os.environ["SKIP_MODEL_LOAD"] = "true"
os.environ["CACHE_BUCKET"] = ""
os.environ["ENABLE_DEBUG_ROUTES"] = "true"
os.environ["ALLOWED_ORIGINS"] = "*"


@pytest.fixture
async def client():
    """Create an httpx AsyncClient with manually-initialized app state."""
    from app.cache.shape_cache import ShapeCache
    from app.config import Settings, get_settings
    from app.main import create_app
    from app.models.registry import ModelRegistry
    from app.services.metrics import PipelineMetrics
    from app.services.pipeline import PipelineOrchestrator

    get_settings.cache_clear()

    # Re-assert env vars inside fixture (other fixtures may pop them)
    os.environ["SKIP_MODEL_LOAD"] = "true"
    os.environ["CACHE_BUCKET"] = ""
    os.environ["ENABLE_DEBUG_ROUTES"] = "true"
    os.environ["ALLOWED_ORIGINS"] = "*"

    app = create_app()

    # Manually initialize app.state (lifespan doesn't run with ASGITransport)
    settings = Settings(cache_bucket="", skip_model_load=True)
    registry = ModelRegistry(settings)
    cache = ShapeCache(bucket_name="", memory_capacity=10)
    await cache.connect()
    metrics = PipelineMetrics()
    orchestrator = PipelineOrchestrator(registry, cache, settings, metrics=metrics)

    app.state.model_registry = registry
    app.state.shape_cache = cache
    app.state.settings = settings
    app.state.metrics = metrics
    app.state.pipeline_orchestrator = orchestrator

    # Register mock models
    sdxl = MagicMock()
    sdxl.generate.return_value = PIL.Image.new("RGB", (512, 512))
    registry.register("sdxl_turbo", sdxl)

    partcrafter = MagicMock()
    meshes = [trimesh.creation.box(extents=[0.2, 0.2, 0.2]) for _ in range(6)]
    partcrafter.generate.return_value = meshes
    registry.register("partcrafter", partcrafter)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ─────────────────────────────────────────────────────────────────────────────
# 1. Happy Path
# ─────────────────────────────────────────────────────────────────────────────


class TestGenerateEndpoint:
    """Tests for POST /generate."""

    @pytest.mark.asyncio
    async def test_valid_request_returns_200(self, client: AsyncClient) -> None:
        """Happy path: POST /generate with mocked models → 200 with full payload."""
        response = await client.post("/generate", json={"text": "horse"})
        assert response.status_code == 200
        data = response.json()
        assert "positions" in data
        assert "part_ids" in data
        assert "part_names" in data
        assert "template_type" in data
        assert "bounding_box" in data
        assert "pipeline" in data
        assert data["cached"] is False
        assert data["generation_time_ms"] >= 0


# ─────────────────────────────────────────────────────────────────────────────
# 2. Cache Hit + 3. Cache Miss → Generation → Cache Write
# ─────────────────────────────────────────────────────────────────────────────


class TestCacheIntegration:
    """Tests that caching works end-to-end."""

    @pytest.mark.asyncio
    async def test_second_request_hits_cache(self, client: AsyncClient) -> None:
        """Cache hit: second request for same concept returns cached=True."""
        r1 = await client.post("/generate", json={"text": "cat"})
        assert r1.status_code == 200
        assert r1.json()["cached"] is False

        r2 = await client.post("/generate", json={"text": "cat"})
        assert r2.status_code == 200
        assert r2.json()["cached"] is True

    @pytest.mark.asyncio
    async def test_cache_write_after_miss(self, client: AsyncClient) -> None:
        """Cache miss → generation → cache write: verify full flow."""
        r1 = await client.post("/generate", json={"text": "owl"})
        assert r1.status_code == 200
        assert r1.json()["cached"] is False

        # Second request should be cached
        r2 = await client.post("/generate", json={"text": "owl"})
        assert r2.status_code == 200
        assert r2.json()["cached"] is True

        # Verify the cached data matches
        assert r1.json()["positions"] == r2.json()["positions"]
        assert r1.json()["part_ids"] == r2.json()["part_ids"]


# ─────────────────────────────────────────────────────────────────────────────
# 7. Health Endpoints
# ─────────────────────────────────────────────────────────────────────────────


class TestHealthEndpoints:
    @pytest.mark.asyncio
    async def test_liveness_returns_200(self, client: AsyncClient) -> None:
        """GET /health → 200."""
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    @pytest.mark.asyncio
    async def test_readiness_returns_200(self, client: AsyncClient) -> None:
        """GET /health/ready → 200 with mocked registry."""
        response = await client.get("/health/ready")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_detailed_health(self, client: AsyncClient) -> None:
        """GET /health/detailed → includes GPU info and models."""
        response = await client.get("/health/detailed")
        assert response.status_code == 200
        data = response.json()
        assert "models_loaded" in data
        assert "status" in data


# ─────────────────────────────────────────────────────────────────────────────
# 8. Metrics Endpoint
# ─────────────────────────────────────────────────────────────────────────────


class TestMetricsEndpoint:
    @pytest.mark.asyncio
    async def test_metrics_returns_200(self, client: AsyncClient) -> None:
        """GET /metrics → verify structure matches PipelineMetrics.to_dict() schema."""
        response = await client.get("/metrics")
        assert response.status_code == 200
        data = response.json()
        assert "requests_total" in data
        assert "latency_p50_ms" in data
        assert "cache_hit_rate" in data
        assert "uptime_seconds" in data
        assert data["uptime_seconds"] >= 0

    @pytest.mark.asyncio
    async def test_metrics_track_requests(self, client: AsyncClient) -> None:
        """Metrics increment after a generate request."""
        await client.post("/generate", json={"text": "dog"})
        data = (await client.get("/metrics")).json()
        assert data["requests_total"] >= 1

    @pytest.mark.asyncio
    async def test_prometheus_metrics_endpoint(self, client: AsyncClient) -> None:
        """GET /metrics/prometheus → returns Prometheus text format."""
        response = await client.get("/metrics/prometheus")
        assert response.status_code == 200
        assert "text/plain" in response.headers["content-type"]
        text = response.text
        # Check for key metrics in the exposition format
        assert "lumen_cache_hit_ratio" in text
        assert "lumen_model_load_status" in text


# ─────────────────────────────────────────────────────────────────────────────
# 9. Error Handling — Validation Errors
# ─────────────────────────────────────────────────────────────────────────────


class TestValidationErrors:
    @pytest.mark.asyncio
    async def test_empty_text_returns_422(self, client: AsyncClient) -> None:
        """POST /generate with empty text → 422 validation error."""
        response = await client.post("/generate", json={"text": ""})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_too_long_text_returns_422(self, client: AsyncClient) -> None:
        """POST /generate with text >200 chars → 422."""
        response = await client.post("/generate", json={"text": "a" * 201})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_no_text_returns_422(self, client: AsyncClient) -> None:
        """POST /generate with no text param → 422."""
        response = await client.post("/generate")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_numeric_only_text_rejected(self, client: AsyncClient) -> None:
        """POST /generate with numeric-only text → 422 validation error."""
        response = await client.post("/generate", json={"text": "12345"})
        assert response.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# 10. CORS
# ─────────────────────────────────────────────────────────────────────────────


class TestCORS:
    @pytest.mark.asyncio
    async def test_cors_preflight_returns_200(self, client: AsyncClient) -> None:
        """OPTIONS /generate preflight → 200 with correct CORS headers.

        Regression test: the APIKeyMiddleware used to intercept OPTIONS
        requests and return 400 because preflights don't carry X-API-Key.
        """
        response = await client.options(
            "/generate",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type,X-API-Key",
            },
        )
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers

