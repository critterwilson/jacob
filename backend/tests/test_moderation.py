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


def test_hash_check_without_endpoint_raises(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Unset JACOB_HASH_SERVICE_URL must fail closed, not pass the image."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_SERVICE_URL_ENV, raising=False)
    import pytest
    with pytest.raises(RuntimeError, match="CSAM hash service URL unset"):
        moderation.check_hash_service("deadbeef")


def test_hash_check_without_endpoint_captures_sentry(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Unset URL is surfaced via Sentry so it's visible in the dashboard."""
    monkeypatch.delenv(moderation.DISABLE_MODERATION_ENV, raising=False)
    monkeypatch.delenv(moderation.HASH_SERVICE_URL_ENV, raising=False)

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


def test_report_to_ncmec_logs_stub(monkeypatch, caplog) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv(moderation.NCMEC_ENDPOINT_ENV, raising=False)
    with caplog.at_level("ERROR"):
        moderation.report_to_ncmec(
            image_hash="deadbeef",
            uploader_uid="alice",
            object_name="uploads/alice/abc.jpg",
        )
    assert any("ncmec_report_stub" in r.message for r in caplog.records)


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
