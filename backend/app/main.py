import logging
import logging.config

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.logging import StructuredLoggingMiddleware
from app.middleware.rate_limit import limiter
from app.routers import account, admin, analytics, groups, invites, reports, search, uploads
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
app.add_middleware(StructuredLoggingMiddleware)

# Starlette stubs widen the handler exception type to `Exception`; FastAPI
# dispatches by class at runtime, so the narrower signatures are safe.
app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.include_router(groups.router)
app.include_router(invites.router)
app.include_router(uploads.router)
app.include_router(reports.router)
app.include_router(admin.router)
app.include_router(account.router)
app.include_router(search.router)
app.include_router(analytics.router)

if settings.debug:
    from app.routers import debug

    app.include_router(debug.router)
    logger.warning("Debug endpoints enabled — do not run in production")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
