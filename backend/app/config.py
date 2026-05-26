from functools import lru_cache

from pydantic import model_validator
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

    # Search (ADR 0016) — native Firestore search over message
    # `searchTokens`. Feature-flagged so the endpoint can be disabled
    # without redeploying.
    jacob_search_enabled: bool = False

    # T29 — BigQuery sticker analytics
    bq_analytics_dataset: str = "jacob_analytics"
    bq_project: str = ""  # defaults to google_cloud_project at runtime
    jacob_analytics_enabled: bool = False

    # Auto-populated on Cloud Run / GCF; falls through to bq_project /
    # analytics when set. Declared explicitly so pydantic-settings owns
    # the read instead of scattered `os.environ.get("GOOGLE_CLOUD_PROJECT")`.
    google_cloud_project: str = ""

    # T10 — Storage buckets. Empty defaults; storage helpers raise a
    # 500 config_error when accessed without the bucket configured, so
    # missing values fail closed at first use rather than at import.
    jacob_media_quarantine_bucket: str = ""
    jacob_media_public_bucket: str = ""

    # T10 — Moderation pipeline knobs (previously read as raw env vars).
    # See docs/moderation-pipeline.md and docs/runbooks/csam-incident.md.
    jacob_disable_moderation: bool = False
    jacob_hash_provider: str = ""
    # Legacy URL-only var; honoured when jacob_hash_provider is unset.
    jacob_hash_service_url: str = ""
    jacob_ncmec_endpoint: str = ""
    # C3 — kill-switch on auto-submission to NCMEC from the upload pipeline.
    # Defaults to True because the HTTPS integration isn't wired yet; operators
    # handle submissions manually via /admin/ncmec.
    jacob_ncmec_submit_disabled: bool = True

    # T63 — operator-side kill-switch on the manual NCMEC submit endpoint.
    # Distinct from jacob_ncmec_submit_disabled (which gates the upload-finalize
    # auto-path); this one is read by services/ncmec.submit_case.
    ncmec_submit_disabled: bool = False

    # T64 — appeals self-review override (test/dev only, see services/appeals.py).
    jacob_allow_self_appeal_review: bool = False

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

    # M5 — SSE chat stream kill-switch. When True, the
    # `GET /api/groups/{gid}/messages/stream` endpoint returns 503 and
    # every client drops back to the 10s polling fallback. The lever to
    # pull if the stream surface misbehaves in production; see ADR 0013
    # and `docs/runbooks/realtime-messages.md`.
    jacob_messages_stream_disabled: bool = False

    # CORS — origins allowed to call the API cross-origin. Frontend is
    # served from a different host than Cloud Run, so without an explicit
    # allowlist the browser preflight blocks every /api/* call.
    #
    # The default is empty for any non-development environment: staging
    # and production MUST set CORS_ALLOWED_ORIGINS as a Cloud Run env var
    # (see .github/workflows/deploy.yml). Defaulting localhost+staging+prod
    # everywhere meant a misconfigured prod deploy would silently allow
    # localhost (a leaked dev tool) and the staging hosted.app URL — both
    # cross-origin holes the original review flagged as H4.
    #
    # Dev still gets the localhost shortcut so `uvicorn` works out of the box.
    cors_allowed_origins: str = ""

    # Detected environment, used to pick safe defaults. Set by deploy infra
    # (`ENVIRONMENT=staging` etc); local dev leaves it as "development".
    environment: str = "development"

    # When True, `get_current_user` falls back to verifying Firebase Auth
    # **emulator** tokens (unsigned, alg=none) after the real-JWKS path
    # fails. Set on the staging Cloud Run service (`JACOB_ALLOW_EMULATOR_TOKENS=1`)
    # so the Playwright suite can hit it with tokens minted by a local
    # Auth emulator without burning real-Firebase rate limits.
    #
    # SECURITY: enabling this lets anyone forge a Bearer token claiming
    # any uid for the staging project. Hard-blocked in production by the
    # `_block_emulator_tokens_in_production` validator below — staging
    # holds throwaway data only.
    jacob_allow_emulator_tokens: bool = False

    # M4 (deletion-cascade) — Realtime Database URL used by the
    # finalize-account job to sweep `presence/{gid}/{uid}`,
    # `typing/{gid}/{uid}`, and `watch/{gid}/{sessionId}` (leaderUid)
    # for a deleted user. Empty disables the RTDB sweep with a single
    # info log line; the rest of finalize_account still runs.
    # Format: `https://{project}-default-rtdb.{region}.firebasedatabase.app`
    # (or the legacy `https://{project}.firebaseio.com`).
    firebase_database_url: str = ""

    # T55 — custom domains. Subdomain claims live under
    # `*.{jacob_base_domain}` (the wildcard mapping itself is a one-time
    # infra step, see docs/runbooks/custom-domains.md). The reserved
    # list is comma-separated and includes infrastructure subdomains
    # we never let an org claim — the deploy default covers the
    # current Jacob platform; expand the env var when a new system
    # subdomain goes live.
    jacob_base_domain: str = "jacob.app"
    jacob_reserved_subdomains: str = (
        "api,www,admin,status,dashboard,help,blog,mail,smtp,imap,"
        "ns1,ns2,app,auth,docs,static,support,internal,platform"
    )

    @model_validator(mode="after")
    def _block_emulator_tokens_in_production(self) -> "Settings":
        # Hard fail-closed: production must never accept emulator tokens.
        # Catches a misconfigured deploy that copies the staging env-var
        # into prod by mistake.
        if self.jacob_allow_emulator_tokens and self.environment == "production":
            raise ValueError(
                "JACOB_ALLOW_EMULATOR_TOKENS=1 is forbidden in production "
                "(would accept signature-less Firebase tokens for any uid)."
            )
        return self

    @model_validator(mode="after")
    def _validate_hash_provider(self) -> "Settings":
        # Fail-closed at boot if JACOB_HASH_PROVIDER is set to something
        # that isn't a recognised sentinel or http(s) URL. Previously the
        # bad-value check lived in services/moderation, so a typo only
        # surfaced at first-upload — misconfigured deploys then rejected
        # real user uploads. Validating here means the container fails to
        # start, which is the louder + safer signal.
        explicit = (self.jacob_hash_provider or "").strip()
        if not explicit:
            return self
        if explicit in ("disabled", "noop"):
            return self
        if explicit.startswith("http://") or explicit.startswith("https://"):
            return self
        raise ValueError(
            f"JACOB_HASH_PROVIDER={explicit!r} is not a recognised sentinel "
            "('disabled', 'noop') and not an http(s) URL."
        )

    @property
    def cors_origins_list(self) -> list[str]:
        if self.cors_allowed_origins:
            return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]
        # No env override — fall back to the dev shortcut only when actually
        # running locally. Anywhere else (staging, prod) returns [] so a
        # missing CORS_ALLOWED_ORIGINS is a fail-closed configuration error
        # rather than an accidental wildcard.
        if self.environment == "development":
            return ["http://localhost:3000"]
        return []


@lru_cache
def get_settings() -> Settings:
    return Settings()
