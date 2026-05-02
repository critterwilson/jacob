"""Structured JSON logging middleware.

Assigns every request a `request_id` (UUID), measures latency, and emits
a single JSON log line after the response with these fields:

    request_id, uid (if authed), route, method, status, latency_ms

Cloud Logging on Cloud Run automatically parses the JSON payload when logs
are written to stdout in JSON format (configured in main.py).

The `uid` field comes from `request.state.uid`, which `get_current_user`
sets after a successful token verification.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

_RequestResponseEndpoint = Callable[[Request], Awaitable[Response]]


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: _RequestResponseEndpoint) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id

        start = time.perf_counter()
        response: Response = await call_next(request)
        latency_ms = round((time.perf_counter() - start) * 1000, 2)

        uid: str | None = getattr(request.state, "uid", None)

        logger.info(
            json.dumps(
                {
                    "request_id": request_id,
                    "uid": uid,
                    "route": request.url.path,
                    "method": request.method,
                    "status": response.status_code,
                    "latency_ms": latency_ms,
                }
            )
        )

        response.headers["X-Request-ID"] = request_id
        return response
