# ─────────────────────────────────────────────────────────────────────────────
# Tests — API Key Authentication Middleware
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

# ── Helpers ──────────────────────────────────────────────────────────────────

_TEST_API_KEY = "test-secret-key-2026"


def _make_app(api_key: str = "") -> TestClient:
    """Build a test client with the given API key setting.

    When api_key is empty, auth is disabled (default for dev).
    """
    # Clear the lru_cache so each test can inject different settings
    from app.config import get_settings

    get_settings.cache_clear()

    env_overrides = {
        "SKIP_MODEL_LOAD": "true",
        "LOG_JSON": "false",
        "LOG_LEVEL": "DEBUG",
        "CACHE_BUCKET": "",
    }
    if api_key:
        env_overrides["API_KEY"] = api_key

    for k, v in env_overrides.items():
        os.environ[k] = v

    try:
        app = create_app()

        # Mock lifespan dependencies (same approach as conftest.py)
        cache = MagicMock(spec=ShapeCache)
        cache.get = AsyncMock(return_value=None)
        cache.set = AsyncMock()
        cache.stats = AsyncMock(return_value={"memory_cache_size": 0})
        cache.connect = AsyncMock()
        cache.disconnect = AsyncMock()
        cache.clear_memory = MagicMock()
        cache.is_connected = True
        cache.load_all_cached = AsyncMock(return_value=0)
        cache.preload_to_memory = AsyncMock(return_value=False)

        settings = Settings(**{k.lower(): v for k, v in env_overrides.items()})
        registry = ModelRegistry(settings)

        client = TestClient(app, raise_server_exceptions=False)

        # Override app.state after TestClient init (lifespan may have set real ones)
        app.state.model_registry = registry
        app.state.shape_cache = cache
        app.state.settings = settings
        app.state.metrics = PipelineMetrics()

        return client
    finally:
        # Clean up env vars so tests don't leak state
        for k in env_overrides:
            os.environ.pop(k, None)
        get_settings.cache_clear()


# ── Auth Enabled ─────────────────────────────────────────────────────────────


class TestAuthEnabled:
    """When API_KEY is set, non-exempt requests require X-API-Key header."""

    @pytest.fixture(autouse=True)
    def _client(self):
        self.client = _make_app(api_key=_TEST_API_KEY)

    def test_missing_key_returns_401(self):
        """Request without X-API-Key header → 401."""
        response = self.client.get("/debug/health")
        assert response.status_code == 401
        assert response.json()["error"] == "Invalid or missing API key"

    def test_wrong_key_returns_401(self):
        """Request with incorrect API key → 401."""
        response = self.client.get(
            "/debug/health",
            headers={"X-API-Key": "wrong-key"},
        )
        assert response.status_code == 401

    def test_correct_key_passes(self):
        """Request with correct API key → passes to route handler."""
        response = self.client.get(
            "/debug/models",
            headers={"X-API-Key": _TEST_API_KEY},
        )
        # Should not be 401 — the route may return any success status
        assert response.status_code != 401

    def test_health_exempt(self):
        """Health endpoints are exempt from auth (Cloud Run probes)."""
        response = self.client.get("/health")
        assert response.status_code == 200

    def test_health_ready_exempt(self):
        """Readiness endpoint is exempt from auth."""
        response = self.client.get("/health/ready")
        # May return 503 if models not loaded, but should not be 401
        assert response.status_code != 401

    def test_root_exempt(self):
        """Root path is exempt from auth."""
        response = self.client.get("/")
        # FastAPI returns 404 for root by default, but not 401
        assert response.status_code != 401

    def test_401_response_is_json(self):
        """Error response matches LumenError JSON format."""
        response = self.client.get("/debug/health")
        assert response.headers["content-type"] == "application/json"
        body = response.json()
        assert "error" in body

    def test_options_bypasses_auth(self):
        """OPTIONS (CORS preflight) must never require an API key.

        Browsers send OPTIONS without custom headers. If the middleware
        rejects the preflight, the browser blocks the real request entirely.
        This is a regression test for the CORS 400 bug.
        """
        response = self.client.options(
            "/generate",
            headers={
                "Origin": "https://storage.googleapis.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type,X-API-Key",
            },
        )
        # Must NOT be 401 — the CORS middleware should handle this
        assert response.status_code != 401
        # Should be 200 (Starlette CORSMiddleware returns 200 for valid preflight)
        assert response.status_code == 200

    def test_options_on_non_exempt_path_bypasses_auth(self):
        """OPTIONS on a path that normally requires auth still bypasses auth."""
        response = self.client.options("/debug/health")
        assert response.status_code != 401


# ── Auth Disabled ────────────────────────────────────────────────────────────


class TestAuthDisabled:
    """When API_KEY is empty, middleware is not applied."""

    @pytest.fixture(autouse=True)
    def _client(self):
        self.client = _make_app(api_key="")

    def test_no_key_passes(self):
        """Without API_KEY configured, all requests pass."""
        response = self.client.get("/health")
        assert response.status_code == 200

    def test_debug_accessible_without_key(self):
        """Debug routes accessible when auth is disabled."""
        response = self.client.get("/debug/models")
        assert response.status_code == 200
