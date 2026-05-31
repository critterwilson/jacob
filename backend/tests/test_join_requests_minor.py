"""Two-step minor approval tests for the join-request flow.

Supersedes the single-step ADR 0015 model. The load-bearing rules under
test:

1. A minor's `POST /api/groups/{gid}/join-requests` enters at
   `status: "pending_leader"` with `requiresOwnerReview: true`.
2. A group leader's approve endpoint VOUCHES for a minor — it advances
   the request to `pending_owner` and records `leaderVouched`, but never
   creates a member. Adults keep the one-step approve.
3. A group leader can reject a minor at their own stage.
4. The leader-facing list now SHOWS minors at `pending_leader` so the
   leader can vouch.
5. The owner approve endpoint refuses (409 `leader_vouch_required`)
   unless a leader has vouched (status `pending_owner` + `leaderVouched`)
   — the "owner cannot approve without leader vouch" backstop — and
   refuses (422) without parental consent.

Both stages are required: a leader cannot finalize a minor, and an owner
cannot approve one a leader has not vouched for. These run on every PR.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.deps import (
    MembershipContext,
    get_current_user,
    require_leader,
    require_ministry_owner_or_admin,
    require_not_banned,
)
from app.errors import http_exception_handler
from app.models.user import CurrentUser
from app.routers.admin import router as admin_router
from app.routers.discover import router as discover_router


def _applicant_app(uid: str = "minor") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(discover_router)
    user = CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    return app


def _leader_app(uid: str = "leader", gid: str = "g1") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(discover_router)
    user = CurrentUser(uid=uid, email=f"{uid}@example.com", claims={})
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    app.dependency_overrides[require_leader] = lambda: MembershipContext(
        gid=gid, uid=uid, role="leader", group={"name": "G"}
    )
    return app


def _owner_app(uid: str = "owner") -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.include_router(admin_router)
    user = CurrentUser(uid=uid, email=f"{uid}@example.com", claims={"ministry_owner": True})
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    app.dependency_overrides[require_ministry_owner_or_admin] = lambda: user
    return app


def _build_request_mode_db(
    *,
    applicant_is_minor: bool,
    jr_exists: bool = False,
    join_mode: str = "request",
) -> MagicMock:
    """Wire the request-mode happy path: group exists, joinMode=request."""
    db = MagicMock()

    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "name": "G1",
        "joinMode": join_mode,
        "isPrivate": True,
        "archivedAt": None,
        "audience": "christian",
    }

    member_snap = MagicMock()
    member_snap.exists = False

    jr_snap = MagicMock()
    jr_snap.exists = jr_exists
    jr_snap.to_dict.return_value = {"status": "pending_leader"}
    jr_doc_ref = MagicMock()
    jr_doc_ref.get.return_value = jr_snap

    user_snap = MagicMock()
    user_snap.exists = True
    user_snap.to_dict.return_value = {"isMinor": applicant_is_minor}

    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    def _subcol(name: str) -> MagicMock:
        sub = MagicMock()
        if name == "members":
            sub.document.return_value.get.return_value = member_snap
        elif name == "joinRequests":
            sub.document.return_value = jr_doc_ref
        return sub

    group_ref.collection.side_effect = _subcol

    groups_col = MagicMock()
    groups_col.document.return_value = group_ref

    users_col = MagicMock()
    users_col.document.return_value.get.return_value = user_snap

    def _col(name: str) -> MagicMock:
        if name == "groups":
            return groups_col
        return users_col

    db.collection.side_effect = _col
    db._jr_doc_ref = jr_doc_ref  # type: ignore[attr-defined]
    return db


def _minor_decision_db(
    *, status: str, leader_vouched: bool
) -> tuple[MagicMock, MagicMock, MagicMock]:
    """Build a db whose single join-request is a minor in the given state.

    Returns (db, jr_ref, txn). The transaction mock is wired so a router
    using `@gcf.transactional` (patched to identity) sees `jr_ref.get`
    and `group_ref.get` and records `txn.update` / `txn.set` calls.
    """
    db = MagicMock()
    data: dict[str, object] = {
        "status": status,
        "requiresOwnerReview": True,
        "isMinor": True,
        "inviteCode": None,
    }
    if leader_vouched:
        data["leaderVouched"] = {"uid": "leader", "at": "2026-05-30T00:00:00+00:00"}

    jr_snap = MagicMock()
    jr_snap.exists = True
    jr_snap.to_dict.return_value = data
    jr_ref = MagicMock()
    jr_ref.get.return_value = jr_snap

    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {"memberCount": 1, "memberCap": 20}
    group_ref = MagicMock()
    group_ref.get.return_value = group_snap

    member_ref = MagicMock()

    def _subcol(name: str) -> MagicMock:
        sub = MagicMock()
        if name == "joinRequests":
            sub.document.return_value = jr_ref
        elif name == "members":
            sub.document.return_value = member_ref
        return sub

    group_ref.collection.side_effect = _subcol
    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.return_value = groups_col

    txn = MagicMock()
    txn.get.return_value = jr_snap
    db.transaction.return_value = txn
    return db, jr_ref, txn


# ── join-request creation: minor branch ────────────────────────────────────


def test_minor_join_request_enters_pending_leader() -> None:
    db = _build_request_mode_db(applicant_is_minor=True)
    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.write_audit_log"),
    ):
        res = TestClient(_applicant_app(uid="minor")).post(
            "/api/groups/g1/join-requests",
            json={"message": "Please let me in"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["pending"] is True
    assert body["requiresOwnerReview"] is True

    set_call = db._jr_doc_ref.set.call_args[0][0]  # type: ignore[attr-defined]
    # Two-step: a minor starts in the LEADER's queue, not the owner's.
    assert set_call["status"] == "pending_leader"
    assert set_call["isMinor"] is True
    assert set_call["requiresOwnerReview"] is True
    assert set_call["leaderVouched"] is None
    assert set_call["parentalConsentObtained"] is None


def test_minor_open_mode_join_escalates_instead_of_self_joining() -> None:
    """OPUS_REVIEW § P0-2 regression — load-bearing safety (preserved)."""
    db = _build_request_mode_db(applicant_is_minor=True, join_mode="open")
    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.write_audit_log"),
    ):
        res = TestClient(_applicant_app(uid="minor")).post(
            "/api/groups/g1/join-requests",
            json={"message": ""},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body.get("joined") is not True
    assert body["pending"] is True
    assert body["requiresOwnerReview"] is True

    set_call = db._jr_doc_ref.set.call_args[0][0]  # type: ignore[attr-defined]
    assert set_call["status"] == "pending_leader"
    assert set_call["isMinor"] is True
    assert set_call["requiresOwnerReview"] is True


def test_adult_join_request_does_not_set_owner_review() -> None:
    db = _build_request_mode_db(applicant_is_minor=False)
    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.write_audit_log"),
    ):
        res = TestClient(_applicant_app(uid="adult")).post(
            "/api/groups/g1/join-requests",
            json={"message": ""},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["pending"] is True
    assert body["requiresOwnerReview"] is False
    set_call = db._jr_doc_ref.set.call_args[0][0]  # type: ignore[attr-defined]
    assert set_call["status"] == "pending"
    assert set_call["isMinor"] is False
    assert set_call["requiresOwnerReview"] is False


# ── leader stage: vouch / reject a minor ───────────────────────────────────


def test_leader_vouch_advances_minor_to_pending_owner() -> None:
    """A leader VOUCHES for a minor: pending_leader → pending_owner.

    Load-bearing: the leader never creates a member doc — they only
    forward the decision to the owner.
    """
    db, jr_ref, txn = _minor_decision_db(status="pending_leader", leader_vouched=False)
    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", lambda f: f),
        patch("app.routers.discover.write_audit_log"),
    ):
        res = TestClient(_leader_app()).post(
            "/api/groups/g1/join-requests/minor/approve",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "pending_owner"

    update_payload = txn.update.call_args[0][1]
    assert update_payload["status"] == "pending_owner"
    assert update_payload["leaderVouched"]["uid"] == "leader"
    assert "at" in update_payload["leaderVouched"]
    # No member doc created on the vouch path.
    assert txn.set.call_count == 0


def test_leader_cannot_finalize_already_vouched_minor() -> None:
    """A minor already at pending_owner is out of the leader's hands (404)."""
    db, jr_ref, txn = _minor_decision_db(status="pending_owner", leader_vouched=True)
    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", lambda f: f),
        patch("app.routers.discover.write_audit_log"),
    ):
        res = TestClient(_leader_app()).post(
            "/api/groups/g1/join-requests/minor/approve",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 404
    assert txn.set.call_count == 0


def test_leader_can_reject_minor_at_pending_leader() -> None:
    """A leader may decline to vouch — rejecting a pending_leader minor."""
    db, jr_ref, txn = _minor_decision_db(status="pending_leader", leader_vouched=False)
    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", lambda f: f),
        patch("app.routers.discover.write_audit_log"),
    ):
        res = TestClient(_leader_app()).post(
            "/api/groups/g1/join-requests/minor/reject",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"
    assert txn.update.call_args[0][1]["status"] == "rejected"


def test_leader_list_shows_minor_pending_leader() -> None:
    """Two-step: the leader queue now surfaces minors awaiting their vouch."""
    db = MagicMock()
    group_ref = MagicMock()
    groups_col = MagicMock()
    groups_col.document.return_value = group_ref

    adult_snap = MagicMock()
    adult_snap.id = "adult"
    adult_snap.to_dict.return_value = {
        "status": "pending",
        "message": "hi",
        "requestedAt": None,
        "isMinor": False,
        "requiresOwnerReview": False,
    }
    minor_snap = MagicMock()
    minor_snap.id = "minor"
    minor_snap.to_dict.return_value = {
        "status": "pending_leader",
        "message": "let me in",
        "requestedAt": None,
        "isMinor": True,
        "requiresOwnerReview": True,
    }

    jr_col = MagicMock()
    (jr_col.where.return_value.order_by.return_value.limit.return_value.stream).return_value = [
        adult_snap,
        minor_snap,
    ]

    def _subcol(name: str) -> MagicMock:
        if name == "joinRequests":
            return jr_col
        return MagicMock()

    group_ref.collection.side_effect = _subcol

    users_col = MagicMock()
    users_col.document.return_value.get.return_value = MagicMock(exists=False)

    def _col(name: str) -> MagicMock:
        if name == "groups":
            return groups_col
        if name == "users":
            return users_col
        return MagicMock()

    db.collection.side_effect = _col
    db.get_all = MagicMock(return_value=[])

    with patch("app.routers.discover._db", return_value=db):
        res = TestClient(_leader_app()).get(
            "/api/groups/g1/join-requests",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    body = res.json()
    rows = {r["uid"]: r for r in body["requests"]}
    assert "adult" in rows
    assert "minor" in rows
    assert rows["minor"]["status"] == "pending_leader"
    assert rows["minor"]["isMinor"] is True
    assert rows["minor"]["requiresOwnerReview"] is True


# ── owner stage: parental-consent gate + leader-vouch backstop ─────────────


def test_owner_approve_without_consent_returns_422() -> None:
    db, jr_ref, _txn = _minor_decision_db(status="pending_owner", leader_vouched=True)
    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_owner_app()).post(
            "/api/admin/groups/g1/join-requests/minor/approve",
            json={"parentalConsentObtained": False, "parentalConsentNotes": ""},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "parental_consent_required"
    jr_ref.update.assert_not_called()


def test_owner_cannot_approve_minor_without_leader_vouch() -> None:
    """Bypass-proofing — load-bearing: owner cannot approve a minor still
    at pending_leader (no leader vouch), even with parental consent.
    """
    db, jr_ref, txn = _minor_decision_db(status="pending_leader", leader_vouched=False)
    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_owner_app()).post(
            "/api/admin/groups/g1/join-requests/minor/approve",
            json={"parentalConsentObtained": True, "parentalConsentNotes": "ok"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "leader_vouch_required"
    # No member created and no state change.
    jr_ref.update.assert_not_called()
    assert txn.set.call_count == 0


def test_owner_approve_vouched_minor_creates_member() -> None:
    db, jr_ref, txn = _minor_decision_db(status="pending_owner", leader_vouched=True)
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.routers.admin.gcf.transactional", lambda f: f),
        patch("app.routers.admin.write_audit_log"),
    ):
        res = TestClient(_owner_app()).post(
            "/api/admin/groups/g1/join-requests/minor/approve",
            json={"parentalConsentObtained": True, "parentalConsentNotes": "spoke to mom"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "approved"
    # The join-request is finalized and a member doc is written.
    jr_update = txn.update.call_args_list[0][0][1]
    assert jr_update["status"] == "approved"
    assert jr_update["parentalConsentObtained"] is True
    member_payload = txn.set.call_args[0][1]
    assert member_payload["role"] == "member"
    assert member_payload["uid"] == "minor"


def test_owner_approve_adult_request_returns_404() -> None:
    """An adult request is never in the owner's actionable set."""
    db = MagicMock()
    group_ref = MagicMock()
    jr_snap = MagicMock()
    jr_snap.exists = True
    jr_snap.to_dict.return_value = {
        "status": "pending",
        "requiresOwnerReview": False,
        "isMinor": False,
    }
    jr_ref = MagicMock()
    jr_ref.get.return_value = jr_snap

    def _subcol(name: str) -> MagicMock:
        sub = MagicMock()
        if name == "joinRequests":
            sub.document.return_value = jr_ref
        return sub

    group_ref.collection.side_effect = _subcol
    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.return_value = groups_col

    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_owner_app()).post(
            "/api/admin/groups/g1/join-requests/alice/approve",
            json={"parentalConsentObtained": True, "parentalConsentNotes": "ok"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"
    jr_ref.update.assert_not_called()


def test_owner_reject_vouched_minor() -> None:
    db, jr_ref, _txn = _minor_decision_db(status="pending_owner", leader_vouched=True)
    with (
        patch("app.routers.admin._db", return_value=db),
        patch("app.routers.admin.write_audit_log"),
    ):
        res = TestClient(_owner_app()).post(
            "/api/admin/groups/g1/join-requests/minor/reject",
            json={"reason": "Could not verify guardian consent"},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"
    update_payload = jr_ref.update.call_args[0][0]
    assert update_payload["status"] == "rejected"
    assert update_payload["rejectionReason"] == "Could not verify guardian consent"
