from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Sentry (T15)
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.1

    # T18 — Transactional email via SendGrid
    sendgrid_api_key: str = ""
    # Full RFC 5322 sender address, e.g. "JACOB <noreply@yourdomain.com>"
    email_sender: str = "JACOB <noreply@example.com>"
    # Reply-to address that maps to a monitored inbox
    email_reply_to: str = ""

    # T25 — Invite URL base (used in InviteResponse.url)
    app_url: str = "https://jacob.app"

    # T28 — Typesense search sidecar
    typesense_host: str = ""
    typesense_api_key: str = ""
    typesense_collection: str = "messages"
    typesense_timeout_seconds: float = 5.0
    jacob_search_enabled: bool = False
    typesense_membership_cap: int = 100

    # T29 — BigQuery sticker analytics
    bq_analytics_dataset: str = "jacob_analytics"
    bq_project: str = ""  # defaults to GOOGLE_CLOUD_PROJECT at runtime
    jacob_analytics_enabled: bool = False

    # T33 — Bible verse feed
    bible_api_base: str = "https://bible-api.com"
    jacob_verse_translation: str = "web"
    jacob_verse_disabled: bool = False

    # T35 — Weekly digest + one-click unsubscribe
    # HS256 secret for unsubscribe JWT tokens (Secret Manager in prod).
    jwt_unsubscribe_secret: str = ""
    # Kill-switch: set to "true" to enable the digest job.
    jacob_digest_enabled: bool = False
    # Set to "true" in CI / local dev — SendGrid will accept but not deliver.
    sendgrid_sandbox: bool = False
    # Users processed per batch before a 1-second sleep.
    digest_batch_size: int = 200
    # Public URL of the backend API (used in email unsubscribe links).
    api_url: str = "https://api.jacob.app"

    # T37 — Photo size variants (320/640/1280 JPEGs via Cloud Function).
    # When true, the finalize endpoint returns variant URLs in its response.
    jacob_photo_variants_enabled: bool = False

    # T38 — self-serve data export
    # GCS bucket for export bundles (e.g. "jacob-exports-staging").
    # Bucket lifecycle deletes objects after 14 days; signed URL TTL is shorter.
    jacob_export_bucket: str = ""
    # Validity window for the V4 signed download URL emitted to the user.
    jacob_export_signed_url_ttl_days: int = 7
    # Kill-switch — if True, POST /api/account/export returns 503.
    jacob_export_disabled: bool = False

    # Enables the /debug/* endpoints — never set in production
    debug: bool = False

    # CORS — origins allowed to call the API cross-origin. The frontend is
    # served from Firebase App Hosting (a different host than Cloud Run), so
    # without an explicit allowlist the browser preflight blocks every
    # /api/* call from the deployed bundle. Override via env var as a
    # comma-separated string when adding new environments. Defaults cover
    # staging, the well-known production app URL, and local dev on the
    # default Next.js port.
    cors_allowed_origins: str = (
        "https://jacob-frontend--jacob-staging-494515.us-central1.hosted.app,"
        "https://jacob.app,"
        "http://localhost:3000"
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
