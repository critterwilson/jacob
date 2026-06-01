import logging
import logging.config
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import get_settings
from app.errors import (
    http_exception_handler,
    rate_limit_exceeded_handler,
    validation_exception_handler,
)
from app.middleware.logging import StructuredLoggingMiddleware
from app.middleware.rate_limit import limiter
from app.routers import (
    account,
    admin,
    analytics,
    appeals,
    applications,
    boards,
    devotionals,
    discover,
    events,
    flags,
    groups,
    incidents,
    invites,
    leader_applications,
    meeting_address,
    messages,
    ministry_feed,
    ncmec,
    orgs,
    reports,
    search,
    sermons,
    stickers,
    transparency,
    unfurl,
    uploads,
    users,
    watch,
    weekly_sermon,
    wellbeing,
)
from app.services.sentry import init_sentry
from app.services.stream_hub import get_stream_hub

# Emit JSON-formatted logs so Cloud Logging auto-parses them on Cloud Run.
logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "()": "logging.Formatter",
                "fmt": "%(message)s",
            }
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "formatter": "json",
                "stream": "ext://sys.stdout",
            }
        },
        "root": {"handlers": ["stdout"], "level": "INFO"},
    }
)

logger = logging.getLogger(__name__)

init_sentry()

settings = get_settings()


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Cleanup hook for SSE listeners on revision rotation (M5).

    Cloud Run sends SIGTERM with a 10s grace period before SIGKILL on
    revision rotation. Detaching the Firestore listeners explicitly lets
    in-flight SSE generators exit cleanly via `request.is_disconnected`
    instead of dying mid-stream when the gRPC listener thread is yanked.
    """
    yield
    try:
        await get_stream_hub().shutdown()
    except Exception:  # noqa: BLE001
        logger.exception("stream_hub_shutdown_failed")


class _V1PathRewriteMiddleware:
    """Rewrite /api/v1/* → /api/* so the versioned and unversioned surfaces
    route identically.  The unversioned routes remain as a deprecated alias
    — remove them after frontend cutover is confirmed stable in production.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") == "http":
            path: str = scope.get("path", "")
            if path.startswith("/api/v1/"):
                scope["path"] = "/api/" + path[8:]
                scope["raw_path"] = scope["path"].encode("latin-1")
        await self._app(scope, receive, send)


app: FastAPI = FastAPI(title="JACOB API", version="0.1.0", lifespan=_lifespan)

app.state.limiter = limiter
# CORS must be the outermost middleware so its response headers reach the
# browser even when an inner handler raises. Frontend is served from a
# different host than the API (App Hosting → Cloud Run) so the browser
# enforces CORS on every /api/* call from the bundle.
_cors_origins = settings.cors_origins_list
# Audit-log the resolved allowlist on every boot so deploys are traceable.
# An empty list in a non-development env is the explicit fail-closed signal
# documented in `config.py:cors_allowed_origins` — it means
# `CORS_ALLOWED_ORIGINS` was not set on the Cloud Run service.
if not _cors_origins and settings.environment != "development":
    logger.warning(
        "cors_allowlist_empty environment=%s — set CORS_ALLOWED_ORIGINS on the service",
        settings.environment,
    )
else:
    logger.info(
        "cors_allowlist environment=%s origins=%s",
        settings.environment,
        ",".join(_cors_origins) if _cors_origins else "<empty>",
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-Id"],
    expose_headers=["ETag", "X-Request-Id"],
    max_age=600,
)
app.add_middleware(StructuredLoggingMiddleware)
app.add_middleware(_V1PathRewriteMiddleware)

# Starlette stubs widen the handler exception type to `Exception`; FastAPI
# dispatches by class at runtime, so the narrower signatures are safe.
app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.include_router(groups.router)
app.include_router(messages.router)
app.include_router(invites.router)
app.include_router(uploads.router)
app.include_router(reports.router)
app.include_router(admin.router)
app.include_router(account.router)
app.include_router(search.router)
app.include_router(analytics.router)
app.include_router(analytics.org_router)
app.include_router(discover.router)
app.include_router(boards.router)
app.include_router(stickers.router)
app.include_router(users.router)
app.include_router(flags.router)
app.include_router(flags.admin_router)
app.include_router(orgs.router)
app.include_router(orgs.public_router)
app.include_router(incidents.router)
app.include_router(incidents.admin_router)
app.include_router(devotionals.router)
app.include_router(sermons.router)
app.include_router(weekly_sermon.router)
app.include_router(weekly_sermon.admin_router)
app.include_router(unfurl.router)
app.include_router(events.router)
app.include_router(watch.router)
app.include_router(ncmec.router)
app.include_router(appeals.appellant_router)
app.include_router(appeals.admin_router)
app.include_router(transparency.public_router)
app.include_router(transparency.admin_router)
app.include_router(transparency.org_router)
app.include_router(applications.router)
app.include_router(leader_applications.router)
app.include_router(meeting_address.router)
app.include_router(meeting_address.admin_router)
app.include_router(ministry_feed.router)
app.include_router(wellbeing.router)
app.include_router(wellbeing.admin_router)

if settings.debug:
    from app.routers import debug

    app.include_router(debug.router)
    logger.warning("Debug endpoints enabled — do not run in production")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
