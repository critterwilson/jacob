FROM python:3.12-slim AS builder

WORKDIR /build
RUN pip install --no-cache-dir uv
COPY pyproject.toml .
# Create a stub package so hatchling resolves all [project.dependencies] from pyproject.toml
RUN mkdir -p app && touch app/__init__.py
RUN uv pip install --system --no-cache .

FROM python:3.12-slim

RUN adduser --disabled-password --gecos "" app
WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY app/ ./app/

USER app
ENV PORT=8080
EXPOSE $PORT

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
