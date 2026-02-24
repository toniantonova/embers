# ─────────────────────────────────────────────────────────────────────────────
# Test Fixtures — shared across all tests
# ─────────────────────────────────────────────────────────────────────────────

import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.cache.shape_cache import ShapeCache
from app.config import Settings
from app.main import create_app
from app.models.registry import ModelRegistry
from app.services.metrics import PipelineMetrics
from app.services.pipeline import PipelineOrchestrator


@pytest.fixture
def test_settings() -> Settings:
    """Settings configured for testing — no GPU, no Cloud Storage."""
    return Settings(
        cache_bucket="",
        skip_model_load=True,
        enable_debug_routes=True,
        log_json=False,
        log_level="DEBUG",
    )


@pytest.fixture
def mock_registry(test_settings: Settings) -> ModelRegistry:
    """ModelRegistry that skips loading."""
    return ModelRegistry(test_settings)


@pytest.fixture
def mock_cache() -> ShapeCache:
    """ShapeCache with async methods mocked."""
    cache = MagicMock(spec=ShapeCache)
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock()
    cache.stats = AsyncMock(
        return_value={
            "memory_cache_size": 0,
            "memory_hits": 0,
            "storage_hits": 0,
            "misses": 0,
            "hit_rate": 0,
        }
    )
    cache.connect = AsyncMock()
    cache.disconnect = AsyncMock()
    cache.clear_memory = MagicMock()
    cache.is_connected = True
    cache.load_all_cached = AsyncMock(return_value=0)
    cache.preload_to_memory = AsyncMock(return_value=False)
    return cache


@pytest.fixture
def client(
    test_settings: Settings, mock_registry: ModelRegistry, mock_cache: ShapeCache
) -> TestClient:
    """FastAPI TestClient with mocked dependencies.

    We clear the settings cache and set env vars so the lifespan
    (which runs inside TestClient) uses test-safe settings — no GCS,
    no model loading, no network calls.
    """
    from app.config import get_settings

    get_settings.cache_clear()

    # Set env vars so the lifespan's get_settings() returns test-safe values
    env_overrides = {
        "SKIP_MODEL_LOAD": "true",
        "CACHE_BUCKET": "",
        "LOG_JSON": "false",
        "LOG_LEVEL": "DEBUG",
        "ENABLE_DEBUG_ROUTES": "true",
        "ALLOWED_ORIGINS": "*",  # Tests need permissive CORS (prod defaults to deny-all)
    }
    for k, v in env_overrides.items():
        os.environ[k] = v

    try:
        app = create_app()
        client = TestClient(app)

        # Override app.state with test mocks (lifespan may have set real ones)
        metrics = PipelineMetrics()
        app.state.model_registry = mock_registry
        app.state.shape_cache = mock_cache
        app.state.settings = test_settings
        app.state.metrics = metrics
        app.state.pipeline_orchestrator = PipelineOrchestrator(
            mock_registry, mock_cache, test_settings, metrics=metrics
        )

        return client
    finally:
        for k in env_overrides:
            os.environ.pop(k, None)
        get_settings.cache_clear()
