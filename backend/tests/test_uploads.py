"""Tests for the uploads router (T10).

The signed-URL flow, GCS bucket calls, Cloud Vision, and the CSAM hash
service are all stubbed at the module level so tests never reach the
network. `get_current_user` is overridden the same way the groups
router tests do it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.uploads import router
from app.services import moderation


def _make_app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid=uid, email=f"{uid}@example.com", claims={}
    )
    return app


def _make_db_with_membership(*, is_member: bool) -> MagicMock:
    """`groups/{gid}/members/{uid}.exists == is_member`, plus collection-write capture."""
    db = MagicMock()

    member_snap = MagicMock()
    member_snap.exists = is_member
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap

    group_ref = MagicMock()
    group_ref.collection.return_value.document.return_value = member_ref

    uploads_doc = MagicMock()
    moderation_doc = MagicMock()

    def _col(name: str) -> MagicMock:
        col = MagicMock()
        if name == "groups":
            col.document.return_value = group_ref
        elif name == "uploads":
            col.document.return_value = uploads_doc
        elif name == "moderation_queue":
            col.document.return_value = moderation_doc
        return col

    db.collection.side_effect = _col
    db._uploads_doc = uploads_doc  # type: ignore[attr-defined]
    db._moderation_doc = moderation_doc  # type: ignore[attr-defined]
    return db


def _make_finalize_db(
    *,
    uploader_uid: str,
    upload_status: str = "pending",
    object_name: str = "uploads/alice/abc.jpg",
    mime_type: str = "image/jpeg",
    upload_exists: bool = True,
) -> MagicMock:
    db = MagicMock()
    snap = MagicMock()
    snap.exists = upload_exists
    snap.to_dict.return_value = {
        "uploaderUid": uploader_uid,
        "status": upload_status,
        "objectName": object_name,
        "mimeType": mime_type,
    }
    upload_doc = MagicMock()
    upload_doc.get.return_value = snap

    moderation_doc = MagicMock()

    def _col(name: str) -> MagicMock:
        col = MagicMock()
        if name == "uploads":
            col.document.return_value = upload_doc
        elif name == "moderation_queue":
            col.document.return_value = moderation_doc
        return col

    db.collection.side_effect = _col
    db._upload_doc = upload_doc  # type: ignore[attr-defined]
    db._moderation_doc = moderation_doc  # type: ignore[attr-defined]
    return db


# ── POST /api/uploads/photos ─────────────────────────────────────────────────


def test_create_upload_message_happy_path() -> None:
    db = _make_db_with_membership(is_member=True)
    expires = datetime(2026, 5, 1, tzinfo=UTC) + timedelta(minutes=5)

    with (
        patch("app.routers.uploads._db", return_value=db),
        patch(
            "app.routers.uploads.storage.generate_signed_put_url",
            return_value=("https://signed.example/PUT?token=abc", expires),
        ),
    ):
        res = TestClient(_make_app()).post(
            "/api/uploads/photos",
            json={
                "purpose": "message",
                "mimeType": "image/jpeg",
                "byteCount": 100_000,
                "groupId": "g1",
            },
        )

    assert res.status_code == 201
    body = res.json()
    assert body["uploadUrl"] == "https://signed.example/PUT?token=abc"
    assert body["uploadId"]
    assert body["expiresAt"]
    db._uploads_doc.set.assert_called_once()


def test_create_upload_avatar_does_not_require_group() -> None:
    db = _make_db_with_membership(is_member=False)  # membership not consulted
    expires = datetime(2026, 5, 1, tzinfo=UTC)

    with (
        patch("app.routers.uploads._db", return_value=db),
        patch(
            "app.routers.uploads.storage.generate_signed_put_url",
            return_value=("https://signed.example/PUT", expires),
        ),
    ):
        res = TestClient(_make_app()).post(
            "/api/uploads/photos",
            json={
                "purpose": "avatar",
                "mimeType": "image/png",
                "byteCount": 50_000,
            },
        )

    assert res.status_code == 201


def test_create_upload_oversize_is_422() -> None:
    res = TestClient(_make_app()).post(
        "/api/uploads/photos",
        json={
            "purpose": "avatar",
            "mimeType": "image/jpeg",
            "byteCount": 9 * 1024 * 1024,
        },
    )
    assert res.status_code == 422


def test_create_upload_wrong_mime_is_422() -> None:
    res = TestClient(_make_app()).post(
        "/api/uploads/photos",
        json={
            "purpose": "avatar",
            "mimeType": "image/gif",
            "byteCount": 1000,
        },
    )
    assert res.status_code == 422


def test_create_upload_message_without_group_id_is_422() -> None:
    db = _make_db_with_membership(is_member=True)
    with patch("app.routers.uploads._db", return_value=db):
        res = TestClient(_make_app()).post(
            "/api/uploads/photos",
            json={
                "purpose": "message",
                "mimeType": "image/jpeg",
                "byteCount": 1000,
            },
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_create_upload_non_member_returns_403() -> None:
    db = _make_db_with_membership(is_member=False)
    with patch("app.routers.uploads._db", return_value=db):
        res = TestClient(_make_app()).post(
            "/api/uploads/photos",
            json={
                "purpose": "message",
                "mimeType": "image/jpeg",
                "byteCount": 1000,
                "groupId": "g1",
            },
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


# ── POST /api/uploads/{id}/finalize ───────────────────────────────────────────


def test_finalize_happy_path_returns_public_url() -> None:
    db = _make_finalize_db(uploader_uid="alice")
    with (
        patch("app.routers.uploads._db", return_value=db),
        patch(
            "app.routers.uploads.storage.download_quarantine_object",
            return_value=b"image-bytes",
        ),
        patch(
            "app.routers.uploads.moderation.check_hash_service",
            return_value=moderation.HashCheckResult(matched=False),
        ),
        patch(
            "app.routers.uploads.moderation.check_safesearch",
            return_value=moderation.SafeSearchResult(verdict="pass"),
        ),
        patch(
            "app.routers.uploads.storage.promote_to_public",
            return_value="https://storage.googleapis.com/jacob-media-public-test/uploads/alice/abc.jpg",
        ) as promote_mock,
    ):
        res = TestClient(_make_app()).post("/api/uploads/abc/finalize")

    assert res.status_code == 200
    assert res.json()["publicUrl"].endswith("/uploads/alice/abc.jpg")
    promote_mock.assert_called_once()
    db._upload_doc.update.assert_called()  # status -> approved


def test_finalize_csam_hit_returns_451_and_records_queue() -> None:
    db = _make_finalize_db(uploader_uid="alice")
    quarantine_mock = MagicMock()
    ncmec_mock = MagicMock()

    with (
        patch("app.routers.uploads._db", return_value=db),
        patch(
            "app.routers.uploads.storage.download_quarantine_object",
            return_value=b"image-bytes",
        ),
        patch(
            "app.routers.uploads.moderation.check_hash_service",
            return_value=moderation.HashCheckResult(matched=True, source="ncmec"),
        ),
        patch(
            "app.routers.uploads.storage.quarantine_permanently",
            quarantine_mock,
        ),
        patch(
            "app.routers.uploads.moderation.report_to_ncmec",
            ncmec_mock,
        ),
        patch("app.routers.uploads.storage.promote_to_public") as promote_mock,
    ):
        res = TestClient(_make_app()).post("/api/uploads/abc/finalize")

    assert res.status_code == 451
    assert res.json()["error"]["code"] == "csam_hash_match"
    quarantine_mock.assert_called_once()
    ncmec_mock.assert_called_once()
    promote_mock.assert_not_called()
    db._moderation_doc.set.assert_called_once()
    args = db._moderation_doc.set.call_args[0][0]
    assert args["reason"] == "csam_hash_match"
    assert args["status"] == "pending"


def test_finalize_safesearch_fail_returns_422_and_quarantines() -> None:
    db = _make_finalize_db(uploader_uid="alice")
    quarantine_mock = MagicMock()

    with (
        patch("app.routers.uploads._db", return_value=db),
        patch(
            "app.routers.uploads.storage.download_quarantine_object",
            return_value=b"image-bytes",
        ),
        patch(
            "app.routers.uploads.moderation.check_hash_service",
            return_value=moderation.HashCheckResult(matched=False),
        ),
        patch(
            "app.routers.uploads.moderation.check_safesearch",
            return_value=moderation.SafeSearchResult(verdict="fail", reason="adult"),
        ),
        patch(
            "app.routers.uploads.storage.quarantine_permanently",
            quarantine_mock,
        ),
        patch("app.routers.uploads.storage.promote_to_public") as promote_mock,
    ):
        res = TestClient(_make_app()).post("/api/uploads/abc/finalize")

    assert res.status_code == 422
    body = res.json()
    assert body["error"]["code"] == "safesearch_blocked"
    assert body["error"]["details"]["reason"] == "adult"
    quarantine_mock.assert_called_once()
    promote_mock.assert_not_called()
    args = db._moderation_doc.set.call_args[0][0]
    assert args["reason"] == "safesearch_adult"


def test_finalize_not_uploader_returns_403() -> None:
    db = _make_finalize_db(uploader_uid="someone-else")
    with patch("app.routers.uploads._db", return_value=db):
        res = TestClient(_make_app()).post("/api/uploads/abc/finalize")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_finalize_unknown_upload_returns_404() -> None:
    db = _make_finalize_db(uploader_uid="alice", upload_exists=False)
    with patch("app.routers.uploads._db", return_value=db):
        res = TestClient(_make_app()).post("/api/uploads/missing/finalize")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "upload_not_found"


def test_finalize_already_finalized_returns_409() -> None:
    db = _make_finalize_db(uploader_uid="alice", upload_status="approved")
    with patch("app.routers.uploads._db", return_value=db):
        res = TestClient(_make_app()).post("/api/uploads/abc/finalize")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "upload_already_finalized"
