"""Tests for the weekly digest Cloud Run Job (T35)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ── helpers ────────────────────────────────────────────────────────────────────

def _make_prefs_snap(uid: str) -> MagicMock:
    snap = MagicMock()
    snap.reference.path = f"users/{uid}/notificationPrefs/main"
    return snap


def _make_db(*, digest_uids: list[str]) -> MagicMock:
    db = MagicMock()
    prefs_snaps = [_make_prefs_snap(uid) for uid in digest_uids]
    db.collection_group.return_value.where.return_value.stream.return_value = iter(prefs_snaps)
    db.collection.return_value.add.return_value = MagicMock()
    return db


def _payload(uid: str = "u1", *, email: str = "u@example.com") -> MagicMock:
    p = MagicMock()
    p.uid = uid
    p.email = email
    p.display_name = "User"
    p.quiet_week = True
    return p


# ── tests ──────────────────────────────────────────────────────────────────────

def test_job_skips_users_with_digest_false(monkeypatch: pytest.MonkeyPatch) -> None:
    """Users not returned by the digest==true query are not emailed."""
    monkeypatch.setenv("JACOB_DIGEST_ENABLED", "true")
    db = MagicMock()
    db.collection_group.return_value.where.return_value.stream.return_value = iter([])

    with patch("app.services.digest.assemble_user_payload") as mock_assemble, \
         patch("app.services.email.send_weekly_digest") as mock_send:
        from infra.scheduled.weekly_digest import run
        result = run(db=db, bq_client=None, dataset="ds", batch_size=200)

    assert result["sent"] == 0
    mock_assemble.assert_not_called()
    mock_send.assert_not_called()


def test_job_batches_at_200_with_1s_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """After DIGEST_BATCH_SIZE users, the job sleeps exactly 1 second."""
    monkeypatch.setenv("JACOB_DIGEST_ENABLED", "true")
    batch = 5
    n_users = batch + 1

    db = _make_db(digest_uids=[f"u{i}" for i in range(n_users)])
    payloads = [_payload(f"u{i}", email=f"u{i}@x.com") for i in range(n_users)]

    with patch("app.services.digest.assemble_user_payload", side_effect=payloads), \
         patch("app.services.email.send_weekly_digest"), \
         patch("app.services.unsubscribe.mint_unsubscribe_token", return_value="tok"), \
         patch("infra.scheduled.weekly_digest.time") as mock_time:
        from infra.scheduled.weekly_digest import run
        result = run(db=db, bq_client=None, dataset="ds", batch_size=batch)

    assert result["sent"] == n_users
    mock_time.sleep.assert_called_once_with(1)


def test_job_handles_sendgrid_500_via_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    """A send failure is counted and logged; the job does not raise."""
    monkeypatch.setenv("JACOB_DIGEST_ENABLED", "true")
    db = _make_db(digest_uids=["u1"])
    payload = _payload("u1", email="u1@x.com")

    with patch("app.services.digest.assemble_user_payload", return_value=payload), \
         patch("app.services.unsubscribe.mint_unsubscribe_token", return_value="tok"), \
         patch("app.services.email.send_weekly_digest", side_effect=RuntimeError("500")), \
         patch("infra.scheduled.weekly_digest._write_audit") as mock_audit, \
         patch("sentry_sdk.capture_exception"):
        from infra.scheduled.weekly_digest import run
        result = run(db=db, bq_client=None, dataset="ds", batch_size=200)

    assert result["failed"] == 1
    assert result["sent"] == 0
    mock_audit.assert_called_once()


def test_job_writes_audit_for_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    """Final send failure writes an audit_log entry and forwards to Sentry."""
    monkeypatch.setenv("JACOB_DIGEST_ENABLED", "true")
    db = _make_db(digest_uids=["u1"])
    payload = _payload("u1", email="u1@x.com")
    exc = RuntimeError("final failure")

    captured: list[Exception] = []

    with patch("app.services.digest.assemble_user_payload", return_value=payload), \
         patch("app.services.unsubscribe.mint_unsubscribe_token", return_value="tok"), \
         patch("app.services.email.send_weekly_digest", side_effect=exc), \
         patch("infra.scheduled.weekly_digest._write_audit") as mock_audit, \
         patch("sentry_sdk.capture_exception", side_effect=lambda: captured.append(exc)):
        from infra.scheduled.weekly_digest import run
        result = run(db=db, bq_client=None, dataset="ds", batch_size=200)

    assert result["failed"] == 1
    mock_audit.assert_called_once_with(db, "u1", "send_failed")
    assert len(captured) == 1
