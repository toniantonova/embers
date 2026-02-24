# API Key authentication middleware with constant-time comparison to prevent timing attacks.
# Uses frozenset for O(1) exempt path lookup. Disabled when api_key is empty.


import secrets
from typing import Any

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = structlog.get_logger(__name__)

# Exempt paths: health probes (Cloud Run liveness/readiness), metrics, root
_EXEMPT_PATHS: frozenset[str] = frozenset(
    {
        "/",
        "/health",
        "/health/ready",
        "/metrics",
    }
)


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Validate X-API-Key header (exempt: health probes, metrics, root)."""

    def __init__(self, app: Any, *, api_key: str) -> None:
        super().__init__(app)
        self._api_key = api_key

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method == "OPTIONS":
            return await call_next(request)

        if request.url.path in _EXEMPT_PATHS:
            return await call_next(request)

        provided_key = request.headers.get("x-api-key", "")

        # Constant-time comparison prevents timing side-channel attacks
        if not provided_key or not secrets.compare_digest(provided_key, self._api_key):
            logger.warning(
                "auth_rejected",
                path=request.url.path,
                method=request.method,
                reason="invalid_or_missing_api_key",
            )
            return JSONResponse(
                status_code=401,
                content={"error": "Invalid or missing API key"},
            )

        return await call_next(request)
