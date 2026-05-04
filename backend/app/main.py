import logging
import logging.config

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.logging import StructuredLoggingMiddleware
from app.middleware.rate_limit import limiter
from app.routers import (
    account,
    admin,
    analytics,
    appeals,
    boards,
    devotionals,
    discover,
    events,
    flags,
    groups,
    incidents,
    invites,
    messages,
    ncmec,
    orgs,
    reports,
    search,
    sermons,
    stickers,
    unfurl,
    uploads,
    users,
    verse,
    watch,
)
from app.services.sentry import init_sentry

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

app: FastAPI = FastAPI(title="JACOB API", version="0.1.0")

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

# Starlette stubs widen the handler exception type to `Exception`; FastAPI
# dispatches by class at runtime, so the narrower signatures are safe.
app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

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
app.include_router(verse.router)
app.include_router(flags.router)
app.include_router(flags.admin_router)
app.include_router(orgs.router)
app.include_router(orgs.public_router)
app.include_router(incidents.router)
app.include_router(incidents.admin_router)
app.include_router(devotionals.router)
app.include_router(sermons.router)
app.include_router(unfurl.router)
app.include_router(events.router)
app.include_router(watch.router)
app.include_router(ncmec.router)
app.include_router(appeals.appellant_router)
app.include_router(appeals.admin_router)

if settings.debug:
    from app.routers import debug

    app.include_router(debug.router)
    logger.warning("Debug endpoints enabled — do not run in production")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
