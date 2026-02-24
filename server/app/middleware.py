# ─────────────────────────────────────────────────────────────────────────────
# Request Middleware — request ID, timing, structured logging
# ─────────────────────────────────────────────────────────────────────────────


import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = structlog.get_logger()


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Adds request ID, logs timing, attaches context for structured logging.

    Skips logging for /health (too noisy from Cloud Run probes).
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:  # noqa: ANN001
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        start = time.perf_counter()

        response: Response = await call_next(request)

        duration_ms = (time.perf_counter() - start) * 1000

        # Don't log health probes (too noisy from Cloud Run)
        if not request.url.path.startswith("/health"):
            logger.info(
                "request_completed",
                request_id=request_id,
                method=request.method,
                path=str(request.url.path),
                status=response.status_code,
                duration_ms=round(duration_ms, 1),
            )

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-Ms"] = str(round(duration_ms, 1))
        return response
