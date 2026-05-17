"""M5 regression — ensure moderation / NCMEC / storage / appeals / analytics
read their environment knobs through :class:`app.config.Settings` rather than
scattered ``os.environ.get`` calls. The service module is the *interface*
to those knobs; this test pins the contract by flipping the env vars and
asserting the matching service helper sees the change.

If a future refactor brings back ``os.environ.get`` calls, the service
behaviour will still pass — but the source-grep at the bottom of this
file will fail, which is the loud signal we want.
"""

from __future__ import annotations

from pathlib import Path

from app.config import Settings


def test_settings_exposes_consolidated_fields() -> None:
    """All env vars the M5 cluster used to read live on Settings now."""
    s = Settings()
    # Each ``hasattr`` is intentionally explicit so a renamed field surfaces
    # as a specific failure rather than a generic AttributeError downstream.
    assert hasattr(s, "jacob_disable_moderation")
    assert hasattr(s, "jacob_hash_provider")
    assert hasattr(s, "jacob_hash_service_url")
    assert hasattr(s, "jacob_ncmec_endpoint")
    assert hasattr(s, "jacob_ncmec_submit_disabled")
    assert hasattr(s, "ncmec_submit_disabled")
    assert hasattr(s, "jacob_media_quarantine_bucket")
    assert hasattr(s, "jacob_media_public_bucket")
    assert hasattr(s, "google_cloud_project")
    assert hasattr(s, "jacob_allow_self_appeal_review")


def test_moderation_disabled_flows_through_settings(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.services import moderation

    monkeypatch.setenv("JACOB_DISABLE_MODERATION", "true")
    assert moderation.moderation_disabled() is True

    monkeypatch.setenv("JACOB_DISABLE_MODERATION", "false")
    assert moderation.moderation_disabled() is False


def test_ncmec_submit_disabled_flows_through_settings(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.services import ncmec

    monkeypatch.setenv("NCMEC_SUBMIT_DISABLED", "true")
    assert ncmec.submit_disabled() is True

    monkeypatch.setenv("NCMEC_SUBMIT_DISABLED", "false")
    assert ncmec.submit_disabled() is False


def test_storage_bucket_names_flow_through_settings(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.services import storage

    monkeypatch.setenv("JACOB_MEDIA_QUARANTINE_BUCKET", "quarantine-bkt")
    monkeypatch.setenv("JACOB_MEDIA_PUBLIC_BUCKET", "public-bkt")
    assert storage.quarantine_bucket_name() == "quarantine-bkt"
    assert storage.public_bucket_name() == "public-bkt"


def test_appeals_self_review_override_flows_through_settings(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.services import appeals

    monkeypatch.setenv("JACOB_ALLOW_SELF_APPEAL_REVIEW", "true")
    assert appeals._self_review_override() is True

    monkeypatch.setenv("JACOB_ALLOW_SELF_APPEAL_REVIEW", "false")
    assert appeals._self_review_override() is False


def test_no_remaining_os_environ_calls_in_consolidated_modules() -> None:
    """Source grep — the M5 modules must not re-introduce ``os.environ`` reads."""
    repo_root = Path(__file__).resolve().parents[1]
    targets = [
        repo_root / "app" / "services" / "ncmec.py",
        repo_root / "app" / "services" / "moderation.py",
        repo_root / "app" / "services" / "storage.py",
        repo_root / "app" / "services" / "analytics.py",
        repo_root / "app" / "services" / "appeals.py",
    ]
    offenders: list[str] = []
    for path in targets:
        text = path.read_text(encoding="utf-8")
        if "os.environ" in text:
            offenders.append(str(path.relative_to(repo_root)))
    assert not offenders, f"M5 modules must not call os.environ directly — offenders: {offenders}"
