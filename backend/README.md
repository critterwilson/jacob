# JACOB Backend

FastAPI service deployed on Cloud Run. Handles server-trusted operations: auth
verification, image moderation, admin actions, and account lifecycle. Real-time
chat data goes directly through Firestore — this service is not in that path.

## Prerequisites

- Python 3.12
- [uv](https://docs.astral.sh/uv/) — `pip install uv`

## Local setup

```bash
cd backend
uv pip install --system -e ".[dev]"
```

## Run the dev server

```bash
uvicorn app.main:app --reload
# Listening at http://localhost:8000
# Health check: GET http://localhost:8000/health
```

## Run tests

```bash
pytest
```

## Lint and type-check

```bash
ruff check .
black --check .
mypy app/
```

## Environment variables

| Variable | Required from | Description |
|---|---|---|
| `PORT` | T01 | Port Cloud Run injects (default 8080 in the container) |
| `FIREBASE_AUTH_EMULATOR_HOST` | T03 | Set to `127.0.0.1:9099` when using the local emulator |
| `GOOGLE_APPLICATION_CREDENTIALS` | T03 | Path to service account JSON for local dev (not needed on Cloud Run with ADC) |

Add new variables here and to `.env.example` as tasks are implemented.
