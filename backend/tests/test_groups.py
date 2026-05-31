"""Tests for the groups router.

firebase_admin and _db are mocked so tests never hit Firestore or
Google's auth endpoints. `get_current_user` is overridden via
FastAPI's dependency-override mechanism so the router sees a real
CurrentUser without touching firebase_admin.auth.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.errors import APIError, http_exception_handler
from app.models.user import CurrentUser
from app.routers.groups import router


def _make_app(uid: str = "alice", *, is_owner: bool = True) -> FastAPI:
    """Return a minimal FastAPI app with the groups router and a mocked user.

    ADR 0015: `POST /api/groups` is owner/admin-only. Tests default to
    granting the owner claim on the CurrentUser so the real
    `require_ministry_owner_or_admin` dep passes; the dep still composes
    `require_not_banned`, which the banned-path tests exercise via
    `patch("app.deps.get_firestore", return_value=banned_db())`. Pass
    `is_owner=False` to assert the 403 refusal explicitly.
    """
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(router)
    claims = {"ministry_owner": True} if is_owner else {}
    user = CurrentUser(uid=uid, email=f"{uid}@example.com", claims=claims)
    app.dependency_overrides[get_current_user] = lambda: user
    return app


def _make_db(
    *,
    stream_results: list[object] | None = None,
    member_exists: bool = False,
    group_exists: bool = True,
    member_role: str = "leader",
) -> MagicMock:
    db = MagicMock()

    groups_col = MagicMock()
    users_col = MagicMock()

    def _col(name: str) -> MagicMock:
        return groups_col if name == "groups" else users_col

    db.collection.side_effect = _col

    groups_col.where.return_value.limit.return_value.stream.return_value = iter(
        stream_results or []
    )

    group_ref = MagicMock()
    group_snap = MagicMock()
    group_snap.exists = group_exists
    group_ref.get.return_value = group_snap
    groups_col.document.return_value = group_ref

    member_snap = MagicMock()
    member_snap.exists = member_exists
    member_snap.get.return_value = member_role
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap
    group_ref.collection.return_value.document.return_value = member_ref

    db.batch.return_value = MagicMock()
    return db


# ── POST /api/groups ─────────────────────────────────────────────────────────


def test_create_group_happy_path() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="TESTCODE1"),
    ):
        res = TestClient(_make_app()).post(
            "/api/groups",
            json={"name": "My Group", "description": "A test group", "isPrivate": False},
        )

    assert res.status_code == 201
    body = res.json()
    assert "groupId" in body
    assert body["inviteCode"] == "TESTCODE1"
    mock_db.batch.return_value.commit.assert_called_once()


def test_create_group_empty_name_returns_422() -> None:
    with patch("app.routers.groups._db", return_value=_make_db()):
        res = TestClient(_make_app()).post("/api/groups", json={"name": ""})

    assert res.status_code == 422


def test_create_group_default_audience_is_christian() -> None:
    """T56 — back-compat: omitting `audience` keeps the Phase 1 default."""
    mock_db = _make_db()
    captured: list[object] = []

    def _capture_batch() -> MagicMock:
        b = MagicMock()
        b.set.side_effect = lambda _ref, data, **_k: captured.append(data)
        return b

    mock_db.batch.side_effect = _capture_batch
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="C1"),
    ):
        TestClient(_make_app()).post("/api/groups", json={"name": "G"})

    group_doc = next((d for d in captured if isinstance(d, dict) and "name" in d), None)
    assert group_doc is not None
    assert group_doc["audience"] == "christian"
    assert group_doc["stickerSet"] == "christian"


def test_create_group_bjj_audience_persists() -> None:
    """T56 — caller-supplied audience pins both `audience` and `stickerSet`."""
    mock_db = _make_db()
    captured: list[object] = []

    def _capture_batch() -> MagicMock:
        b = MagicMock()
        b.set.side_effect = lambda _ref, data, **_k: captured.append(data)
        return b

    mock_db.batch.side_effect = _capture_batch
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="C2"),
    ):
        TestClient(_make_app()).post(
            "/api/groups",
            json={"name": "Mat Time", "audience": "bjj"},
        )

    group_doc = next((d for d in captured if isinstance(d, dict) and "name" in d), None)
    assert group_doc is not None
    assert group_doc["audience"] == "bjj"
    assert group_doc["stickerSet"] == "bjj"


def test_create_group_invalid_audience_returns_422() -> None:
    """T56 — only the three known audiences are accepted."""
    with patch("app.routers.groups._db", return_value=_make_db()):
        res = TestClient(_make_app()).post(
            "/api/groups",
            json={"name": "G", "audience": "yoga"},
        )
    assert res.status_code == 422


def test_create_group_strips_and_stores_name() -> None:
    mock_db = _make_db()
    captured: list[object] = []

    def _capture_batch() -> MagicMock:
        b = MagicMock()

        def _set(ref: object, data: object, **_kwargs: object) -> None:
            captured.append(data)

        b.set.side_effect = _set
        return b

    mock_db.batch.side_effect = _capture_batch

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="CODE1234"),
    ):
        res = TestClient(_make_app()).post("/api/groups", json={"name": "  Padded  "})

    assert res.status_code == 201
    group_doc = next((d for d in captured if isinstance(d, dict) and "name" in d), None)
    assert group_doc is not None
    assert group_doc["name"] == "Padded"


# ── POST /api/groups/join ─────────────────────────────────────────────────────


def test_join_group_happy_path() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups.consume_invite", return_value=("group-abc", "inv001")),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_make_app("bob")).post("/api/groups/join", json={"code": "TESTCODE1"})

    assert res.status_code == 200
    assert res.json()["groupId"] == "group-abc"


def test_join_invalid_code_returns_404() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch(
            "app.routers.groups.consume_invite",
            side_effect=APIError(
                status_code=404, code="invalid_invite", message="Invite code not found"
            ),
        ),
    ):
        res = TestClient(_make_app()).post("/api/groups/join", json={"code": "BADCODE1"})

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "invalid_invite"


def test_join_already_member_returns_409() -> None:
    mock_db = _make_db()
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch(
            "app.routers.groups.consume_invite",
            side_effect=APIError(
                status_code=409, code="already_member", message="Already a member"
            ),
        ),
    ):
        res = TestClient(_make_app()).post("/api/groups/join", json={"code": "TESTCODE1"})

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "already_member"


# ── POST /api/groups/{gid}/invite/rotate ─────────────────────────────────────


def test_rotate_invite_happy_path() -> None:
    mock_db = _make_db(group_exists=True, member_exists=True, member_role="leader")

    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.routers.groups._unique_invite_code", return_value="NEWCODE12"),
    ):
        res = TestClient(_make_app()).post("/api/groups/gid-001/invite/rotate")

    assert res.status_code == 200
    assert res.json()["inviteCode"] == "NEWCODE12"


def test_rotate_invite_non_leader_returns_403() -> None:
    mock_db = _make_db(group_exists=True, member_exists=True, member_role="member")

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app("bob")).post("/api/groups/gid-001/invite/rotate")

    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_rotate_invite_group_not_found_returns_404() -> None:
    mock_db = _make_db(group_exists=False)

    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/ghost-gid/invite/rotate")

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "group_not_found"


# ── T23: POST /api/groups/{gid}/archive + unarchive ──────────────────────────


def _make_archive_db(*, archived_at: object = None, member_role: str = "leader") -> MagicMock:
    """Build a mock DB wired up for archive/unarchive tests."""
    db = MagicMock()
    groups_col = MagicMock()
    db.collection.side_effect = lambda name: groups_col if name == "groups" else MagicMock()

    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"archivedAt": archived_at}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    member_snap = MagicMock()
    member_snap.exists = True
    member_snap.to_dict.return_value = {"role": member_role}
    member_ref = MagicMock()
    member_ref.get.return_value = member_snap

    group_ref.collection.return_value.document.return_value = member_ref
    groups_col.document.return_value = group_ref
    return db


def test_archive_group_happy_path() -> None:
    mock_db = _make_archive_db(archived_at=None)
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post("/api/groups/gid-001/archive", json={"reason": "test"})

    assert res.status_code == 200
    body = res.json()
    assert body["gid"] == "gid-001"
    assert "archivedAt" in body


def test_archive_group_already_archived_returns_409() -> None:
    mock_db = _make_archive_db(archived_at=datetime(2026, 1, 1, tzinfo=UTC))
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/gid-001/archive", json={})

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "already_archived"


def test_archive_group_not_leader_returns_403() -> None:
    mock_db = _make_archive_db(archived_at=None, member_role="member")
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/gid-001/archive", json={})

    assert res.status_code == 403
    # PR5: require_leader returns the more specific code; old inline helper
    # said "forbidden", canonical dep says "not_a_leader".
    assert res.json()["error"]["code"] == "not_a_leader"


def test_unarchive_group_happy_path() -> None:
    # Relative date inside the _ARCHIVE_HIDE_DAYS (60) window. Previously
    # hardcoded to 2026-04-01, which silently tipped past the 60-day
    # cutoff once the calendar reached 2026-05-31 and started returning
    # 410 — a date bomb. Use a recent relative date so the test stays
    # green regardless of the run date. The too-old (410) sibling test
    # already uses `now - 61 days`.
    archived_ts = datetime.now(UTC) - timedelta(days=5)
    mock_db = _make_archive_db(archived_at=archived_ts)
    with (
        patch("app.routers.groups._db", return_value=mock_db),
        patch("app.services.audit._db", return_value=mock_db),
    ):
        res = TestClient(_make_app()).post("/api/groups/gid-001/unarchive")

    assert res.status_code == 200
    assert res.json()["gid"] == "gid-001"


def test_unarchive_group_not_archived_returns_409() -> None:
    mock_db = _make_archive_db(archived_at=None)
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/gid-001/unarchive")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "not_archived"


def test_unarchive_group_too_old_returns_410() -> None:
    stale = datetime.now(UTC) - timedelta(days=61)
    mock_db = _make_archive_db(archived_at=stale)
    with patch("app.routers.groups._db", return_value=mock_db):
        res = TestClient(_make_app()).post("/api/groups/gid-001/unarchive")

    assert res.status_code == 410
    assert res.json()["error"]["code"] == "archive_too_old"


# ── 403 banned coverage (PR1 sweep) ─────────────────────────────────────────


def test_create_group_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post(
            "/api/groups", json={"name": "G", "description": "", "isPrivate": False}
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_join_group_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post("/api/groups/join", json={"code": "ABC"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_rotate_invite_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post("/api/groups/g1/invite/rotate")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_archive_group_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post("/api/groups/g1/archive", json={"reason": "x"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"


def test_unarchive_group_403_banned() -> None:
    from tests.conftest import banned_db

    with patch("app.deps.get_firestore", return_value=banned_db()):
        res = TestClient(_make_app()).post("/api/groups/g1/unarchive")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "banned"
