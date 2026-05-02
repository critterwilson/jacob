import logging

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError

from app.errors import http_exception_handler, validation_exception_handler
from app.routers import account, admin, groups, uploads

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app: FastAPI = FastAPI(title="JACOB API", version="0.1.0")
# Starlette stubs widen the handler exception type to `Exception`; FastAPI
# dispatches by class at runtime, so the narrower signatures are safe.
app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]

app.include_router(groups.router)
app.include_router(uploads.router)
app.include_router(admin.router)
app.include_router(account.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
