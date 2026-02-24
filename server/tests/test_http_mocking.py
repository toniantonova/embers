# ─────────────────────────────────────────────────────────────────────────────
# HTTP Mocking Tests — respx
# ─────────────────────────────────────────────────────────────────────────────
# Demonstrates: respx for transport-layer HTTP mocking of httpx requests.
#
# respx intercepts httpx requests at the transport layer (in-process,
# no Docker containers, no network). Since FastAPI's TestClient uses
# httpx under the hood, this is the clean way to mock outbound HTTP
# calls your server makes (e.g., to external APIs or services).
#
# For GCS specifically, we mock the client directly (see conftest.py).
# respx is for when your code makes httpx.AsyncClient calls.
# ─────────────────────────────────────────────────────────────────────────────

import httpx
import pytest
import respx


class TestRespxBasicUsage:
    """Demonstrates respx patterns for mocking httpx requests.

    These are standalone examples showing how to use respx in your
    tests — not tied to a specific endpoint, but showing the patterns
    you'd use when integrating external APIs in Prompts 03/04.
    """

    @respx.mock
    async def test_mock_get_request(self):
        """Mock an outbound GET request."""
        # Arrange: define what the mock should return
        route = respx.get("https://api.example.com/models").mock(
            return_value=httpx.Response(
                200,
                json={"models": ["sdxl-turbo", "partcrafter"]},
            )
        )

        # Act: make the request (this would be in your service code)
        async with httpx.AsyncClient() as client:
            response = await client.get("https://api.example.com/models")

        # Assert
        assert response.status_code == 200
        assert response.json()["models"] == ["sdxl-turbo", "partcrafter"]
        assert route.called  # Verify the route was actually hit
        assert route.call_count == 1

    @respx.mock
    async def test_mock_post_with_json_body(self):
        """Mock a POST request and verify the request body."""
        route = respx.post("https://api.example.com/generate").mock(
            return_value=httpx.Response(
                200,
                json={"id": "gen-123", "status": "completed"},
            )
        )

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.example.com/generate",
                json={"prompt": "a 3D horse"},
            )

        assert response.status_code == 200
        assert response.json()["status"] == "completed"

        # Verify the request was made
        assert route.called
        assert route.call_count == 1

    @respx.mock
    async def test_mock_error_response(self):
        """Simulate an external API returning an error."""
        respx.get("https://api.example.com/health").mock(
            return_value=httpx.Response(503, json={"error": "overloaded"})
        )

        async with httpx.AsyncClient() as client:
            response = await client.get("https://api.example.com/health")

        assert response.status_code == 503
        assert response.json()["error"] == "overloaded"

    @respx.mock
    async def test_mock_network_error(self):
        """Simulate a network failure (timeout, DNS, etc)."""
        respx.get("https://api.example.com/models").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        async with httpx.AsyncClient() as client:
            with pytest.raises(httpx.ConnectError, match="Connection refused"):
                await client.get("https://api.example.com/models")

    @respx.mock
    async def test_pattern_matching(self):
        """Mock all requests matching a URL pattern."""
        # Mock any GET to the /v1/ API namespace
        route = respx.get(url__startswith="https://api.example.com/v1/").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )

        async with httpx.AsyncClient() as client:
            r1 = await client.get("https://api.example.com/v1/models")
            r2 = await client.get("https://api.example.com/v1/status")

        assert route.call_count == 2
        assert r1.json()["ok"] is True
        assert r2.json()["ok"] is True

    @respx.mock
    async def test_unmocked_raises(self):
        """By default, unmocked requests raise an error (fail-safe)."""
        # No routes mocked — respx raises AllMockedAssertionError
        # (not httpx.HTTPError) when assert_all_mocked=True (the default)
        async with httpx.AsyncClient() as client:
            with pytest.raises(Exception, match="not mocked"):
                await client.get("https://api.example.com/unexpected")
