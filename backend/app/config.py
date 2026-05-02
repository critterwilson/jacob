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

    # Enables the /debug/* endpoints — never set in production
    debug: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
