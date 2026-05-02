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

## Grant admin to a user

The backend uses a Firebase Auth custom claim (`admin: true`) to gate
admin-only endpoints. After a user has signed up, run:

```bash
cd backend
python scripts/grant_admin.py <uid>
```

The user must sign out and sign back in (or refresh their ID token)
before the new claim is visible in the token.

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
| `JACOB_MEDIA_QUARANTINE_BUCKET` | T10 | Quarantine GCS bucket name (e.g. `jacob-media-quarantine-staging`) |
| `JACOB_MEDIA_PUBLIC_BUCKET` | T10 | Public CDN-served GCS bucket name |
| `JACOB_HASH_SERVICE_URL` | T10 (prod) | CSAM hash lookup endpoint. Vendor TBD before launch — see `docs/moderation-pipeline.md` |
| `JACOB_NCMEC_ENDPOINT` | T10 (prod) | NCMEC CyberTipline submission endpoint |
| `JACOB_DISABLE_MODERATION` | T10 (dev) | Set to `true` only for local emulator runs to bypass external moderation calls. Must be unset in deployed environments |
| `SENDGRID_API_KEY` | T18 | SendGrid API key. Leave empty in local dev to skip email sending (a warning is logged). |
| `EMAIL_SENDER` | T18 | Full RFC 5322 From address, e.g. `JACOB <noreply@yourdomain.com>` |
| `EMAIL_REPLY_TO` | T18 | Reply-To address that maps to a monitored inbox |
| `TYPESENSE_HOST` | T28 | Internal URL of the Typesense Cloud Run service (e.g. `https://typesense-prod.run.app`) |
| `TYPESENSE_API_KEY` | T28 | Typesense **search** (read-only) API key. The admin/write key lives only in Cloud Functions |
| `TYPESENSE_COLLECTION` | T28 | Typesense collection or alias name (default `messages`) |
| `TYPESENSE_TIMEOUT_SECONDS` | T28 | Per-request timeout for Typesense calls (default `5`) |
| `JACOB_SEARCH_ENABLED` | T28 | Feature flag — when `false`, `/api/search` returns `503 search_disabled`. Flip to `true` after the index has been warmed by `infra/scripts/reindex_messages.py` |

Add new variables here and to `.env.example` as tasks are implemented.
