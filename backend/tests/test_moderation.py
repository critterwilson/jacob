"""Unit tests for the moderation service.

Cloud Vision and the CSAM hash service are stubbed; tests confirm the
disable flag short-circuits external calls.
"""

from __future__ import annotations

from unittest.mock import patch

from app.services import moderation


def test_hash_image_is_sha256() -> None:
    assert moderation.hash_image(b"") == (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_disable_flag_short_circuits_safesearch(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv(moderation.DISABLE_MODERATION_ENV, "true")
    result = moderation.check_safesearch(b"any")
    assert result.verdict == "pass"
    assert result.reason is None


def test_disable_flag_short_circuits_hash_check(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv(moderation.DISABLE_MODERATION_ENV, "true")
    result = moderation.check_hash_service("deadbeef")
    assert result.matched is False


def _force_production_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Force `Settings.environment` to a non-development value so the
    hash-provider resolver does not pick the dev "disabled" default."""
    from app.config import Settings, get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "production")
    # Sanity-check the override took.
    assert Settings().environment == "production"


def test_hash_check_without_provider_raises_in_production(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Unset JACOB_HASH_PROVIDER in production must fail closed."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_PROVIDER_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_SERVICE_URL_ENV, raising=False)
    _force_production_env(monkeypatch)
    import pytest

    with pytest.raises(RuntimeError, match="CSAM hash provider unset"):
        moderation.check_hash_service("deadbeef")


def test_hash_check_without_provider_passes_in_development(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """In development the resolver defaults to 'disabled' so uploads work."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_PROVIDER_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_SERVICE_URL_ENV, raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    result = moderation.check_hash_service("deadbeef")
    assert result.matched is False


def test_hash_check_without_provider_captures_sentry(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """In production the unset case is surfaced via Sentry."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_PROVIDER_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_SERVICE_URL_ENV, raising=False)
    _force_production_env(monkeypatch)

    captured: list[tuple[str, str]] = []

    class _FakeSentry:
        @staticmethod
        def capture_message(msg: str, level: str = "info") -> None:
            captured.append((msg, level))

    monkeypatch.setattr(moderation, "_sentry_sdk", _FakeSentry)
    import pytest

    with pytest.raises(RuntimeError):
        moderation.check_hash_service("deadbeef")
    assert captured and captured[0][1] == "error"


def test_hash_provider_disabled_short_circuits(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """`JACOB_HASH_PROVIDER=disabled` is the explicit no-op, valid in any env."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.setenv(moderation.HASH_PROVIDER_ENV, "disabled")
    _force_production_env(monkeypatch)
    result = moderation.check_hash_service("deadbeef")
    assert result.matched is False


def test_hash_provider_noop_logs_warning(monkeypatch, caplog) -> None:  # type: ignore[no-untyped-def]
    """`noop` returns no-match and emits a WARNING per call."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.setenv(moderation.HASH_PROVIDER_ENV, "noop")
    _force_production_env(monkeypatch)
    with caplog.at_level("WARNING"):
        result = moderation.check_hash_service("deadbeef")
    assert result.matched is False
    assert any("csam_hash_check_noop" in r.message for r in caplog.records)


def test_hash_provider_invalid_value_raises(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Random strings (non-URL, non-sentinel) fail closed."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.setenv(moderation.HASH_PROVIDER_ENV, "totally-not-a-url")
    _force_production_env(monkeypatch)
    import pytest

    with pytest.raises(RuntimeError, match="not a recognised sentinel"):
        moderation.check_hash_service("deadbeef")


def test_hash_provider_legacy_url_env_still_works(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Old `JACOB_HASH_SERVICE_URL` env var continues to drive the URL provider."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_PROVIDER_ENV, raising=False)
    monkeypatch.setenv(moderation.HASH_SERVICE_URL_ENV, "https://hash.example.com/check")
    _force_production_env(monkeypatch)

    class _FakeResp:
        def __init__(self, body: bytes) -> None:
            self._body = body

        def __enter__(self):  # type: ignore[no-untyped-def]
            return self

        def __exit__(self, *exc):  # type: ignore[no-untyped-def]
            return False

        def read(self) -> bytes:
            return self._body

    captured: dict[str, object] = {}

    def _fake_urlopen(req, timeout):  # type: ignore[no-untyped-def]
        captured["url"] = req.full_url
        return _FakeResp(b'{"matched": false}')

    monkeypatch.setattr(moderation.urllib.request, "urlopen", _fake_urlopen)
    result = moderation.check_hash_service("deadbeef")
    assert captured["url"] == "https://hash.example.com/check"
    assert result.matched is False


def test_report_to_ncmec_logs_critical_when_called(monkeypatch, caplog) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv(moderation.NCMEC_ENDPOINT_ENV, raising=False)
    monkeypatch.delenv(moderation.NCMEC_AUTOSUBMIT_DISABLED_ENV, raising=False)
    with caplog.at_level("CRITICAL"):
        case_id = moderation.report_to_ncmec(
            image_hash="deadbeef",
            uploader_uid="alice",
            object_name="uploads/alice/abc.jpg",
        )
    assert case_id is None  # no db passed, no case row created
    assert any(
        "MANUAL_ACTION_REQUIRED" in r.message and "ncmec_report" in r.message
        for r in caplog.records
    )


def test_report_to_ncmec_creates_case_when_db_supplied(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """When the upload pipeline calls with a db client, a case lands in the
    operator queue (`ncmec_cases`) so the manual-handoff is visible at /admin/ncmec."""
    monkeypatch.delenv(moderation.NCMEC_ENDPOINT_ENV, raising=False)

    captured: dict[str, object] = {}

    def _fake_create_case(db, **kwargs):  # type: ignore[no-untyped-def]
        captured["db"] = db
        captured["kwargs"] = kwargs
        return "case-id-123"

    with patch("app.services.ncmec.create_case", _fake_create_case):
        case_id = moderation.report_to_ncmec(
            image_hash="deadbeef",
            uploader_uid="alice",
            object_name="uploads/alice/abc.jpg",
            db="<sentinel-db>",
            hash_source="PhotoDNA",
        )

    assert case_id == "case-id-123"
    assert captured["db"] == "<sentinel-db>"
    assert captured["kwargs"]["hash_source"] == "PhotoDNA"
    assert captured["kwargs"]["hash_value"] == "deadbeef"
    assert captured["kwargs"]["evidence"]["gcsPath"] == "uploads/alice/abc.jpg"
    assert captured["kwargs"]["suspect_uid"] == "alice"


def test_report_to_ncmec_evidence_includes_size_and_content_type(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """M6: operator-queue cases now carry sizeBytes + contentType."""
    monkeypatch.delenv(moderation.NCMEC_ENDPOINT_ENV, raising=False)

    captured: dict[str, object] = {}

    def _fake_create_case(db, **kwargs):  # type: ignore[no-untyped-def]
        captured["kwargs"] = kwargs
        return "case-id-456"

    with patch("app.services.ncmec.create_case", _fake_create_case):
        moderation.report_to_ncmec(
            image_hash="deadbeef",
            uploader_uid="alice",
            object_name="uploads/alice/abc.jpg",
            db="<sentinel-db>",
            hash_source="PhotoDNA",
            size_bytes=12_345,
            content_type="image/jpeg",
        )

    evidence = captured["kwargs"]["evidence"]  # type: ignore[index]
    assert evidence["sizeBytes"] == 12_345
    assert evidence["contentType"] == "image/jpeg"
    assert evidence["gcsPath"] == "uploads/alice/abc.jpg"


def test_ncmec_autosubmit_disabled_default_true(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv(moderation.NCMEC_AUTOSUBMIT_DISABLED_ENV, raising=False)
    assert moderation.ncmec_autosubmit_disabled() is True


def test_ncmec_autosubmit_disabled_explicit_false(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv(moderation.NCMEC_AUTOSUBMIT_DISABLED_ENV, "false")
    assert moderation.ncmec_autosubmit_disabled() is False


def test_ncmec_autosubmit_disabled_explicit_true(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv(moderation.NCMEC_AUTOSUBMIT_DISABLED_ENV, "true")
    assert moderation.ncmec_autosubmit_disabled() is True


def test_safesearch_calls_vision_when_enabled(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)

    class _FakeLikelihood:
        UNKNOWN = 0
        VERY_UNLIKELY = 1
        UNLIKELY = 2
        POSSIBLE = 3
        LIKELY = 4
        VERY_LIKELY = 5

    class _FakeAnnotation:
        adult = _FakeLikelihood.VERY_LIKELY
        violence = _FakeLikelihood.VERY_UNLIKELY
        racy = _FakeLikelihood.VERY_UNLIKELY

    class _FakeResponse:
        safe_search_annotation = _FakeAnnotation()

    class _FakeClient:
        def safe_search_detection(self, image: object) -> _FakeResponse:
            return _FakeResponse()

    fake_vision = type(
        "FakeVisionModule",
        (),
        {
            "ImageAnnotatorClient": _FakeClient,
            "Image": lambda content: object(),
            "Likelihood": _FakeLikelihood,
        },
    )

    with patch.dict("sys.modules", {"google.cloud.vision": fake_vision}):
        result = moderation.check_safesearch(b"image")

    assert result.verdict == "fail"
    assert result.reason == "adult"
