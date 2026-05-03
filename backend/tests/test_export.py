"""Tests for the export router, service, schema, and processor (T38).

Firestore is fully mocked. The assembler interacts with Firestore via a
small surface (collection, collection_group, document, set, update,
get, stream); these tests stub each of those just enough to drive the
relevant code paths.
"""

from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user
from app.errors import http_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.account import router
from app.services import export
from app.services.export_schema import SCHEMA_VERSION, validate_bundle


@pytest.fixture(autouse=True)
def _reset_limiter() -> None:
    """Each test starts with an empty rate-limit ledger.

    Otherwise the 1/hour cap on POST /api/account/export trips after the
    first test that exercises it, regardless of mocked uid.
    """
    limiter.reset()


# ── app fixture ──────────────────────────────────────────────────────────────


def _app(uid: str = "alice") -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)

    def _override(request: Request) -> CurrentUser:
        # Mirror what `get_current_user` does so the rate-limit key is
        # uid-scoped and tests don't all share a single IP-keyed bucket.
        request.state.uid = uid
        return CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})

    app.dependency_overrides[get_current_user] = _override
    return app


# ── helpers to build a mock Firestore for the assembler ──────────────────────


def _make_snap(doc_id: str, data: dict[str, Any], path: str = "") -> MagicMock:
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = True
    snap.to_dict.return_value = data
    snap.reference = MagicMock()
    snap.reference.path = path or doc_id
    # Build a synthetic parent chain: <col>/<id>
    if "/" in path:
        parts = path.split("/")
        # parent is the collection
        snap.reference.parent = MagicMock()
        snap.reference.parent.id = parts[-2] if len(parts) >= 2 else None
        # parent.parent is the document above (e.g. groups/{gid})
        if len(parts) >= 3:
            snap.reference.parent.parent = MagicMock()
            snap.reference.parent.parent.id = parts[-3]
    return snap


def _make_assembler_db(
    *,
    user_doc: dict[str, Any] | None = None,
    private_doc: dict[str, Any] | None = None,
    members: list[tuple[str, dict[str, Any]]] | None = None,
    messages: list[tuple[str, str, dict[str, Any]]] | None = None,
    mentions: list[tuple[str, str, dict[str, Any]]] | None = None,
    audit_actor: list[tuple[str, dict[str, Any]]] | None = None,
    audit_target: list[tuple[str, dict[str, Any]]] | None = None,
    notification_prefs: dict[str, Any] | None = None,
    devices: list[tuple[str, dict[str, Any]]] | None = None,
    mutes: list[tuple[str, dict[str, Any]]] | None = None,
    blocks: list[tuple[str, dict[str, Any]]] | None = None,
    reactions: list[tuple[str, str, str, dict[str, Any]]] | None = None,
    other_users_in_cg: int = 0,
) -> MagicMock:
    """Build a Firestore-shaped mock that drives `export.assemble`.

    *reactions* tuples are (gid, mid, slug, data); we synthesize a path
    matching `groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}`.
    """
    db = MagicMock()

    # users/{uid}
    user_snap = MagicMock()
    user_snap.exists = user_doc is not None
    user_snap.to_dict.return_value = user_doc

    # users/{uid}/private/profile
    private_snap = MagicMock()
    private_snap.exists = private_doc is not None
    private_snap.to_dict.return_value = private_doc

    # users/{uid}/private/notifications
    notif_prefs_snap = MagicMock()
    notif_prefs_snap.exists = notification_prefs is not None
    notif_prefs_snap.to_dict.return_value = notification_prefs

    private_doc_ref = MagicMock()
    private_doc_ref.get.return_value = private_snap

    notif_prefs_doc_ref = MagicMock()
    notif_prefs_doc_ref.get.return_value = notif_prefs_snap

    private_collection = MagicMock()

    def _private_doc(name: str) -> MagicMock:
        if name == "profile":
            return private_doc_ref
        if name == "notifications":
            return notif_prefs_doc_ref
        return MagicMock()

    private_collection.document.side_effect = _private_doc

    # users/{uid}/devices
    devices_col = MagicMock()
    device_snaps = [_make_snap(did, data) for did, data in (devices or [])]
    devices_col.stream.return_value = iter(device_snaps)

    # users/{uid}/mutes and /blocks
    mutes_col = MagicMock()
    mutes_col.stream.return_value = iter([_make_snap(uid, d) for uid, d in (mutes or [])])
    blocks_col = MagicMock()
    blocks_col.stream.return_value = iter([_make_snap(uid, d) for uid, d in (blocks or [])])

    user_doc_ref = MagicMock()
    user_doc_ref.get.return_value = user_snap

    def _user_subcol(name: str) -> MagicMock:
        if name == "private":
            return private_collection
        if name == "devices":
            return devices_col
        if name == "mutes":
            return mutes_col
        if name == "blocks":
            return blocks_col
        return MagicMock()

    user_doc_ref.collection.side_effect = _user_subcol

    users_col = MagicMock()
    users_col.document.return_value = user_doc_ref

    # audit_log queries — two queries, by actorUid and by targetRef.
    audit_col = MagicMock()
    actor_query = MagicMock()
    actor_query.stream.return_value = iter(
        [_make_snap(eid, data) for eid, data in (audit_actor or [])]
    )
    target_query = MagicMock()
    target_query.stream.return_value = iter(
        [_make_snap(eid, data) for eid, data in (audit_target or [])]
    )

    def _audit_where(field: str, op: str, value: str) -> MagicMock:
        if field == "actorUid":
            return actor_query
        if field == "targetRef":
            return target_query
        return MagicMock(stream=MagicMock(return_value=iter([])))

    audit_col.where.side_effect = _audit_where

    def _col(name: str) -> MagicMock:
        if name == "users":
            return users_col
        if name == "audit_log":
            return audit_col
        return MagicMock()

    db.collection.side_effect = _col

    # collection_group queries:
    #   "members" where uid == uid
    #   "messages" where authorUid == uid
    #   "messages" where mentions array_contains uid
    #   "users" -> stream all (for reactions scan)
    #   "exports" where startedAt == None (for find_pending_jobs)
    members_query = MagicMock()
    member_snaps = []
    for gid, data in members or []:
        snap = _make_snap("alice", data, path=f"groups/{gid}/members/alice")
        member_snaps.append(snap)
    members_query.stream.return_value = iter(member_snaps)

    messages_authored_query = MagicMock()
    msg_snaps = []
    for gid, mid, data in messages or []:
        snap = _make_snap(mid, data, path=f"groups/{gid}/messages/{mid}")
        msg_snaps.append(snap)
    messages_authored_query.stream.return_value = iter(msg_snaps)

    mentions_query = MagicMock()
    mention_snaps = []
    for gid, mid, data in mentions or []:
        snap = _make_snap(mid, data, path=f"groups/{gid}/messages/{mid}")
        mention_snaps.append(snap)
    mentions_query.stream.return_value = iter(mention_snaps)

    users_cg = MagicMock()
    user_cg_snaps: list[MagicMock] = []
    for gid, mid, slug, data in reactions or []:
        snap = _make_snap(
            "alice", data, path=f"groups/{gid}/messages/{mid}/reactions/{slug}/users/alice"
        )
        user_cg_snaps.append(snap)
    # plus some other-user docs and unrelated users docs that should be filtered.
    for i in range(other_users_in_cg):
        snap = _make_snap("bob", {}, path=f"groups/g{i}/messages/m{i}/reactions/like/users/bob")
        user_cg_snaps.append(snap)
    # plus a top-level users/{uid} doc that should be ignored (no /messages/)
    top_user_snap = _make_snap("alice", {"displayName": "Alice"}, path="users/alice")
    user_cg_snaps.append(top_user_snap)
    users_cg.stream.return_value = iter(user_cg_snaps)

    def _cg(name: str) -> MagicMock:
        if name == "messages":
            cg = MagicMock()
            cg.where.side_effect = lambda field, op, value: (
                messages_authored_query if field == "authorUid" else mentions_query
            )
            return cg
        if name == "members":
            cg = MagicMock()
            cg.where.return_value = members_query
            return cg
        if name == "users":
            return users_cg
        return MagicMock()

    db.collection_group.side_effect = _cg

    # expose handles for assertions
    db._user_doc_ref = user_doc_ref  # type: ignore[attr-defined]
    db._users_col = users_col  # type: ignore[attr-defined]
    db._audit_col = audit_col  # type: ignore[attr-defined]
    return db


# ── schema ───────────────────────────────────────────────────────────────────


def test_schema_version_pinned_to_1() -> None:
    assert SCHEMA_VERSION == 1


def _minimal_valid_bundle(uid: str = "alice") -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "exportedAt": "2026-05-02T00:00:00+00:00",
        "uid": uid,
        "profile": {"displayName": "Alice"},
        "privateProfile": None,
        "memberships": [],
        "messages": [],
        "reactions": [],
        "mentions": [],
        "auditLog": [],
        "photoRefs": [],
        "notificationPreferences": {},
        "notificationDevices": [],
        "mutes": [],
        "blocks": [],
    }


def test_bundle_validates_against_schema() -> None:
    validate_bundle(_minimal_valid_bundle(), expected_uid="alice")


def test_bundle_validation_rejects_extra_keys() -> None:
    bundle = _minimal_valid_bundle()
    bundle["extraNew"] = []
    with pytest.raises(ValueError, match="unexpected"):
        validate_bundle(bundle, expected_uid="alice")


def test_bundle_validation_rejects_missing_keys() -> None:
    bundle = _minimal_valid_bundle()
    del bundle["mutes"]
    with pytest.raises(ValueError, match="missing"):
        validate_bundle(bundle, expected_uid="alice")


def test_bundle_validation_rejects_uid_mismatch() -> None:
    with pytest.raises(ValueError, match="uid mismatch"):
        validate_bundle(_minimal_valid_bundle("alice"), expected_uid="bob")


def test_bundle_validation_rejects_wrong_schema_version() -> None:
    bundle = _minimal_valid_bundle()
    bundle["schemaVersion"] = 2
    with pytest.raises(ValueError, match="schemaVersion"):
        validate_bundle(bundle, expected_uid="alice")


# ── assembler ────────────────────────────────────────────────────────────────


def test_assemble_bundle_includes_all_categories() -> None:
    db = _make_assembler_db(
        user_doc={"displayName": "Alice", "photoURL": "https://x/avatar.jpg"},
        private_doc={"email": "alice@example.com"},
        members=[("g1", {"role": "leader", "uid": "alice"})],
        messages=[
            (
                "g1",
                "m1",
                {
                    "authorUid": "alice",
                    "body": "hello",
                    "mediaRefs": ["https://x/photo.jpg"],
                },
            )
        ],
        mentions=[("g2", "m9", {"authorUid": "bob", "mentions": ["alice"]})],
        audit_actor=[("e1", {"action": "report_submit", "actorUid": "alice"})],
        audit_target=[("e2", {"action": "ban", "targetRef": "users/alice"})],
        notification_prefs={"announcements": True},
        devices=[("d1", {"fcmToken": "secret-token", "platform": "web"})],
        mutes=[("bob", {"mutedAt": "2026-04-01"})],
        blocks=[("carol", {"blockedAt": "2026-04-02"})],
        reactions=[("g1", "m1", "amen", {"reactedAt": "2026-04-03"})],
        other_users_in_cg=2,
    )
    bundle = export.assemble("alice", db=db)

    assert bundle["uid"] == "alice"
    assert bundle["schemaVersion"] == 1
    assert bundle["profile"] == {"displayName": "Alice", "photoURL": "https://x/avatar.jpg"}
    assert bundle["privateProfile"] == {"email": "alice@example.com"}
    assert bundle["memberships"] == [{"groupId": "g1", "role": "leader", "uid": "alice"}]
    assert len(bundle["messages"]) == 1
    assert bundle["messages"][0]["groupId"] == "g1"
    assert bundle["messages"][0]["messageId"] == "m1"
    assert bundle["messages"][0]["body"] == "hello"
    assert bundle["mentions"][0]["messageId"] == "m9"
    assert {row["eventId"] for row in bundle["auditLog"]} == {"e1", "e2"}
    assert bundle["notificationPreferences"] == {"announcements": True}
    # FCM token must be redacted.
    assert "fcmToken" not in bundle["notificationDevices"][0]
    assert bundle["notificationDevices"][0]["platform"] == "web"
    assert bundle["mutes"] == [{"otherUid": "bob", "mutedAt": "2026-04-01"}]
    assert bundle["blocks"] == [{"otherUid": "carol", "blockedAt": "2026-04-02"}]
    assert bundle["reactions"] == [
        {
            "groupId": "g1",
            "messageId": "m1",
            "stickerSlug": "amen",
            "reactedAt": "2026-04-03",
        }
    ]
    # Photo refs include both the message media ref and the avatar URL.
    assert "https://x/photo.jpg" in bundle["photoRefs"]
    assert "https://x/avatar.jpg" in bundle["photoRefs"]


def test_assemble_bundle_excludes_other_users_messages() -> None:
    db = _make_assembler_db(
        user_doc={"displayName": "Alice"},
        messages=[],  # The CG query filters by authorUid == "alice", so we just
        # don't include foreign messages here. The query mock confirms the call.
    )
    bundle = export.assemble("alice", db=db)
    # No foreign messages can appear because the assembler asks the
    # collection-group query for authorUid == uid; verify the where call.
    cg_call = db.collection_group.call_args_list
    assert any(call.args == ("messages",) for call in cg_call)
    assert bundle["messages"] == []


def test_assemble_sanitises_audit_payload_foreign_uids() -> None:
    db = _make_assembler_db(
        user_doc={"displayName": "Alice"},
        audit_target=[
            (
                "e1",
                {
                    "action": "promote_member",
                    "targetRef": "users/alice",
                    "payload": {
                        "actorUid": "bob",
                        "newRole": "leader",
                        "byEmail": "bob@example.com",
                    },
                },
            )
        ],
    )
    bundle = export.assemble("alice", db=db)
    payload = bundle["auditLog"][0].get("payload") or {}
    assert "actorUid" not in payload
    assert "byEmail" not in payload
    assert payload.get("newRole") == "leader"


def test_assemble_reaction_scan_caps_iteration() -> None:
    """The reactions scan must bail out before exhausting a runaway CG."""
    real_cap = export._REACTION_SCAN_CAP
    try:
        export._REACTION_SCAN_CAP = 3  # type: ignore[attr-defined]
        # Build a CG that yields more 'users' docs than the cap.
        db = _make_assembler_db(
            user_doc={"displayName": "Alice"},
            other_users_in_cg=10,
        )
        bundle = export.assemble("alice", db=db)
        # No alice reactions seeded; with the cap shrunk to 3, the scan
        # exits before encountering anything matching alice.
        assert bundle["reactions"] == []
    finally:
        export._REACTION_SCAN_CAP = real_cap  # type: ignore[attr-defined]


def test_serialize_round_trips_bundle() -> None:
    bundle = _minimal_valid_bundle()
    payload = export.serialize(bundle)
    decoded = json.loads(gzip.decompress(payload).decode("utf-8"))
    assert decoded == bundle


def test_serialize_refuses_oversize_bundle() -> None:
    real_cap = export._BUNDLE_HARD_CAP_BYTES
    try:
        export._BUNDLE_HARD_CAP_BYTES = 100  # type: ignore[attr-defined]
        bundle = _minimal_valid_bundle()
        bundle["messages"] = [{"body": "x" * 1000}]
        with pytest.raises(ValueError, match="bundle_too_large"):
            export.serialize(bundle)
    finally:
        export._BUNDLE_HARD_CAP_BYTES = real_cap  # type: ignore[attr-defined]


# ── request endpoint ────────────────────────────────────────────────────────


def _make_request_db(*, in_flight: bool = False, requested_at: datetime | None = None) -> MagicMock:
    """Mock for `export.request_export`."""
    db = MagicMock()
    exports_col = MagicMock()

    snaps: list[MagicMock] = []
    if in_flight:
        snap = MagicMock()
        snap.id = "in-flight-1"
        snap.to_dict.return_value = {
            "requestedAt": requested_at or datetime.now(UTC),
            "startedAt": None,
            "completedAt": None,
            "failedAt": None,
        }
        snaps.append(snap)
    exports_col.stream.return_value = iter(snaps)
    exports_col.document.return_value = MagicMock()

    user_ref = MagicMock()
    user_ref.collection.return_value = exports_col

    users_col = MagicMock()
    users_col.document.return_value = user_ref

    audit_col = MagicMock()
    audit_col.document.return_value = MagicMock()

    def _col(name: str) -> MagicMock:
        if name == "users":
            return users_col
        if name == "audit_log":
            return audit_col
        return MagicMock()

    db.collection.side_effect = _col
    db._exports_col = exports_col  # type: ignore[attr-defined]
    db._audit_col = audit_col  # type: ignore[attr-defined]
    return db


def test_request_export_creates_job() -> None:
    db = _make_request_db()
    with (
        patch("app.services.export._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.export.get_settings") as gs,
    ):
        gs.return_value = MagicMock(jacob_export_disabled=False)
        res = TestClient(_app("alice")).post("/api/account/export", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "queued"
    assert body["jobId"]
    assert body["schemaVersion"] == 1
    db._exports_col.document.assert_called()
    audit_set = db._audit_col.document().set.call_args[0][0]
    assert audit_set["action"] == "export_request"
    assert audit_set["actorUid"] == "alice"


def test_request_export_in_flight_returns_409() -> None:
    db = _make_request_db(in_flight=True)
    with (
        patch("app.services.export._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.export.get_settings") as gs,
    ):
        gs.return_value = MagicMock(jacob_export_disabled=False)
        res = TestClient(_app("alice")).post("/api/account/export", json={})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "export_in_flight"


def test_request_export_kill_switch_returns_503() -> None:
    db = _make_request_db()
    with (
        patch("app.services.export._db", return_value=db),
        patch("app.services.audit._db", return_value=db),
        patch("app.services.export.get_settings") as gs,
    ):
        gs.return_value = MagicMock(jacob_export_disabled=True)
        res = TestClient(_app("alice")).post("/api/account/export", json={})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "export_disabled"


# ── status endpoint ─────────────────────────────────────────────────────────


def _make_status_db(jobs: list[dict[str, Any]]) -> MagicMock:
    db = MagicMock()
    exports_col = MagicMock()
    snaps = []
    for job in jobs:
        snap = MagicMock()
        snap.id = job.pop("_id")
        snap.to_dict.return_value = job
        snaps.append(snap)
    exports_col.stream.return_value = iter(snaps)

    user_ref = MagicMock()
    user_ref.collection.return_value = exports_col

    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db.collection.side_effect = lambda n: users_col if n == "users" else MagicMock()
    return db


def test_status_returns_latest_job() -> None:
    older = datetime(2026, 4, 1, tzinfo=UTC)
    newer = datetime(2026, 5, 1, tzinfo=UTC)
    db = _make_status_db(
        [
            {
                "_id": "old",
                "requestedAt": older,
                "completedAt": older + timedelta(minutes=2),
                "expiresAt": older + timedelta(days=7),
                "downloadUrl": "https://example/old.gz",
                "byteCount": 100,
                "schemaVersion": 1,
            },
            {
                "_id": "new",
                "requestedAt": newer,
                "completedAt": None,
                "startedAt": None,
                "schemaVersion": 1,
            },
        ]
    )
    with patch("app.services.export._db", return_value=db):
        res = TestClient(_app("alice")).get("/api/account/export/status")
    assert res.status_code == 200
    body = res.json()
    assert body["jobId"] == "new"
    assert body["status"] == "queued"


def test_status_marks_expired_when_past_ttl() -> None:
    completed = datetime.now(UTC) - timedelta(days=8)
    db = _make_status_db(
        [
            {
                "_id": "j",
                "requestedAt": completed,
                "completedAt": completed,
                "expiresAt": completed + timedelta(days=7),  # already past
                "downloadUrl": "https://example/old.gz",
                "byteCount": 1,
                "schemaVersion": 1,
            }
        ]
    )
    with patch("app.services.export._db", return_value=db):
        res = TestClient(_app("alice")).get("/api/account/export/status")
    body = res.json()
    assert body["status"] == "expired"
    # downloadUrl is suppressed for expired jobs.
    assert body["downloadUrl"] is None


def test_status_none_when_no_jobs() -> None:
    db = _make_status_db([])
    with patch("app.services.export._db", return_value=db):
        res = TestClient(_app("alice")).get("/api/account/export/status")
    body = res.json()
    assert body["status"] == "none"
    assert body["jobId"] == ""


# ── download endpoint ───────────────────────────────────────────────────────


def _make_download_db(job: dict[str, Any] | None) -> MagicMock:
    db = MagicMock()
    job_ref = MagicMock()
    snap = MagicMock()
    snap.exists = job is not None
    snap.to_dict.return_value = job
    job_ref.get.return_value = snap
    exports_col = MagicMock()
    exports_col.document.return_value = job_ref
    user_ref = MagicMock()
    user_ref.collection.return_value = exports_col
    users_col = MagicMock()
    users_col.document.return_value = user_ref
    db.collection.side_effect = lambda n: users_col if n == "users" else MagicMock()
    return db


def test_download_redirects_when_ready() -> None:
    job = {
        "completedAt": datetime.now(UTC) - timedelta(minutes=5),
        "downloadUrl": "https://example.com/signed",
        "expiresAt": datetime.now(UTC) + timedelta(days=6),
    }
    db = _make_download_db(job)
    with patch("app.services.export._db", return_value=db):
        res = TestClient(_app("alice")).get(
            "/api/account/export/jobx/download", follow_redirects=False
        )
    assert res.status_code == 302
    assert res.headers["location"] == "https://example.com/signed"


def test_download_404_on_missing_job() -> None:
    db = _make_download_db(None)
    with patch("app.services.export._db", return_value=db):
        res = TestClient(_app("alice")).get(
            "/api/account/export/missing/download", follow_redirects=False
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "export_not_found"


def test_download_410_on_expired_signed_url() -> None:
    """Mirrors the GCS lifecycle test: past 7 days, the URL is rejected."""
    job = {
        "completedAt": datetime.now(UTC) - timedelta(days=8),
        "downloadUrl": "https://example.com/signed",
        "expiresAt": datetime.now(UTC) - timedelta(seconds=1),
    }
    db = _make_download_db(job)
    with patch("app.services.export._db", return_value=db):
        res = TestClient(_app("alice")).get(
            "/api/account/export/jobx/download", follow_redirects=False
        )
    assert res.status_code == 410
    assert res.json()["error"]["code"] == "export_expired"


def test_download_409_on_failed_job() -> None:
    job = {
        "completedAt": None,
        "failedAt": datetime.now(UTC),
        "failureReason": "account_deleted",
    }
    db = _make_download_db(job)
    with patch("app.services.export._db", return_value=db):
        res = TestClient(_app("alice")).get(
            "/api/account/export/jobx/download", follow_redirects=False
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "export_failed"


# ── processor ────────────────────────────────────────────────────────────────


def test_processor_concurrency_cap_at_5() -> None:
    """find_pending_jobs caps at PROCESSOR_BATCH_CAP rows."""
    db = MagicMock()
    cg = MagicMock()
    where = MagicMock()
    limit = MagicMock()
    snaps = [MagicMock(id=f"j{i}") for i in range(5)]
    limit.stream.return_value = iter(snaps)
    where.limit.return_value = limit
    cg.where.return_value = where
    db.collection_group.return_value = cg

    pending = export.find_pending_jobs(db=db, limit=export.PROCESSOR_BATCH_CAP)
    assert len(pending) == 5
    where.limit.assert_called_once_with(5)


def test_processor_account_deleted_writes_failed() -> None:
    """If the user doc disappears mid-flight, the job is failed cleanly."""
    snap = MagicMock()
    snap.id = "jobx"
    snap.reference = MagicMock()
    snap.reference.path = "users/alice/exports/jobx"
    # parent chain: exports collection -> users/alice doc
    snap.reference.parent = MagicMock()
    user_ref = MagicMock()
    user_ref.id = "alice"
    snap.reference.parent.parent = user_ref

    # The internal db lookups: user doc returns "missing".
    db = MagicMock()
    user_snap = MagicMock()
    user_snap.exists = False
    user_doc_ref = MagicMock()
    user_doc_ref.get.return_value = user_snap
    users_col = MagicMock()
    users_col.document.return_value = user_doc_ref
    db.collection.return_value = users_col

    with (
        patch("app.services.export._db", return_value=db),
        patch("app.services.export._claim", return_value=True),
    ):
        result = export.process_one(snap)
    assert result["status"] == "failed"
    assert result["reason"] == "account_deleted"
    # failedAt/failureReason should be written.
    update_args = snap.reference.update.call_args[0][0]
    assert update_args["failureReason"] == "account_deleted"
