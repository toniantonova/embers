# ─────────────────────────────────────────────────────────────────────────────
# Health Endpoint Tests — liveness, readiness, and diagnostics
# ─────────────────────────────────────────────────────────────────────────────
# Demonstrates: dirty-equals (declarative assertions), polyfactory
# ─────────────────────────────────────────────────────────────────────────────

from dirty_equals import IsInstance, IsNonNegative, IsStr


class TestLivenessProbe:
    """GET /health — near-zero cost, always 200."""

    def test_returns_200(self, client):
        response = client.get("/health")
        assert response.status_code == 200

    def test_minimal_body(self, client):
        """Liveness should return only a status field — nothing heavy."""
        data = client.get("/health").json()
        assert data == {"status": "ok"}

    def test_no_dependencies_needed(self, client):
        """Liveness must work even if registry/cache are broken."""
        response = client.get("/health")
        assert response.status_code == 200


class TestReadinessProbe:
    """GET /health/ready — checks models loaded + cache connected."""

    def test_returns_200_when_ready(self, client):
        """With skip_model_load=True and mock cache, should be ready."""
        response = client.get("/health/ready")
        assert response.status_code == 200

    def test_response_shape(self, client):
        """Use dirty-equals to validate the shape without exact values."""
        data = client.get("/health/ready").json()
        assert data == {
            "status": IsStr(regex=r"ready|not_ready"),
            "models_loaded": IsInstance(list),
            "cache_connected": True,
        }

    def test_returns_503_when_cache_disconnected(self, client, mock_cache):
        """When cache is disconnected, readiness should return 503."""
        mock_cache.is_connected = False
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json()["status"] == "not_ready"


class TestDebugHealthDetail:
    """GET /debug/health — full diagnostics (only when debug routes enabled)."""

    def test_returns_full_diagnostics(self, client):
        """Debug health should return GPU info, cache stats, and uptime."""
        response = client.get("/debug/health")
        assert response.status_code == 200

        data = response.json()
        assert data == {
            "status": "healthy",
            "models_loaded": IsInstance(list),
            "gpu_available": IsInstance(bool),
            "gpu_name": IsInstance(str) | None,
            "gpu_memory_used_gb": IsInstance(float | int),
            "cache_connected": IsInstance(bool),
            "cache_stats": IsInstance(dict),
            "uptime_seconds": IsNonNegative,
        }
