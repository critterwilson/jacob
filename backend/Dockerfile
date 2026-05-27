FROM python:3.12-slim@sha256:46cb7cc2877e60fbd5e21a9ae6115c30ace7a077b9f8772da879e4590c18c2e3 AS builder

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN pip install --no-cache-dir uv
COPY backend/pyproject.toml .
# Create a stub package so hatchling resolves all [project.dependencies] from pyproject.toml
RUN mkdir -p app && touch app/__init__.py
RUN uv pip install --system --no-cache .

FROM python:3.12-slim@sha256:46cb7cc2877e60fbd5e21a9ae6115c30ace7a077b9f8772da879e4590c18c2e3

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

RUN adduser --disabled-password --gecos "" app
WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY backend/app/ ./app/
# Cloud Run Jobs invoke entrypoints under /app/scheduled/<name>.py — see
# infra/cloud-run-jobs.tf. Shipping them in the same image as the API
# lets every scheduled task reuse the backend's dependency set, code, and
# Sentry/config plumbing without a second image to build, scan, and push.
COPY infra/scheduled/ ./scheduled/

USER app
ENV PORT=8080
# Scheduled-job scripts at /app/scheduled/*.py import `from app.services …`
# but Python only puts the script's own directory on sys.path. Pin /app so
# `python /app/scheduled/finalize_deletions.py` can resolve the `app` package.
# Harmless for the API: uvicorn already imports app.main via WORKDIR.
ENV PYTHONPATH=/app
EXPOSE $PORT

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips=*"]
