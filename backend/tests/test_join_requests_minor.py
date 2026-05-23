"""ADR 0014 — minor escalation tests for the join-request flow.

The load-bearing safety rules under test:

1. A minor's `POST /api/groups/{gid}/join-requests` stamps the
   join-request with `requiresOwnerReview: true`.
2. A group leader's approve endpoint refuses with 403
   `minor_owner_review_required` when the request has the owner-review
   flag, even if every other check would pass.
3. A group leader's reject endpoint refuses with the same code.
4. The leader-facing list endpoint hides owner-review rows entirely.
5. The owner-facing approve endpoint refuses without parental consent.

These are the rules that protect a child from a group leader making
the decision unilaterally. They run on every PR.
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


def _build_request_mode_db(*, applicant_is_minor: bool, jr_exists: bool = False) -> MagicMock:
    """Wire the request-mode happy path: group exists, joinMode=request."""
    db = MagicMock()

    group_snap = MagicMock()
    group_snap.exists = True
    group_snap.to_dict.return_value = {
        "name": "G1",
        "joinMode": "request",
        "isPrivate": True,
        "archivedAt": None,
        "audience": "christian",
    }

    member_snap = MagicMock()
    member_snap.exists = False

    jr_snap = MagicMock()
    jr_snap.exists = jr_exists
    jr_snap.to_dict.return_value = {"status": "pending"}
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


# ── join-request creation: minor branch ────────────────────────────────────


def test_minor_join_request_sets_requires_owner_review() -> None:
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
    assert set_call["status"] == "pending"
    assert set_call["isMinor"] is True
    assert set_call["requiresOwnerReview"] is True
    assert set_call["parentalConsentObtained"] is None


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
    assert set_call["isMinor"] is False
    assert set_call["requiresOwnerReview"] is False


# ── leader approve/reject must refuse minors ───────────────────────────────


def test_leader_cannot_approve_minor_join_request() -> None:
    """Load-bearing safety: a group leader must NOT be able to approve a
    minor's join-request. ADR 0014 § 4.
    """
    db = MagicMock()
    group_ref = MagicMock()
    group_ref.get.return_value.exists = True
    group_ref.get.return_value.to_dict.return_value = {"memberCount": 1, "memberCap": 20}
    jr_snap = MagicMock()
    jr_snap.exists = True
    jr_snap.to_dict.return_value = {
        "status": "pending",
        "requiresOwnerReview": True,
        "isMinor": True,
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
    db.transaction.return_value = MagicMock()

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", lambda f: f),
    ):
        res = TestClient(_leader_app()).post(
            "/api/groups/g1/join-requests/minor/approve",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "minor_owner_review_required"


def test_leader_cannot_reject_minor_join_request() -> None:
    """Symmetric to approve — a leader doesn't decide on a minor at all."""
    db = MagicMock()
    group_ref = MagicMock()
    jr_snap = MagicMock()
    jr_snap.exists = True
    jr_snap.to_dict.return_value = {
        "status": "pending",
        "requiresOwnerReview": True,
        "isMinor": True,
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
    db.transaction.return_value = MagicMock()

    # The reject endpoint uses a transactional read; emulate that by
    # making the txn.get(jr_ref) call return our snap.
    txn = MagicMock()
    txn.get.return_value = jr_snap
    db.transaction.return_value = txn

    with (
        patch("app.routers.discover._db", return_value=db),
        patch("app.routers.discover.gcf.transactional", lambda f: f),
    ):
        res = TestClient(_leader_app()).post(
            "/api/groups/g1/join-requests/minor/reject",
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "minor_owner_review_required"


def test_leader_list_hides_minor_join_requests() -> None:
    """ADR 0014: minor rows are removed from the leader-facing list entirely."""
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
        "status": "pending",
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
    uids = {r["uid"] for r in body["requests"]}
    assert "adult" in uids
    assert "minor" not in uids


# ── owner-side approve: parental consent gate ──────────────────────────────


def test_owner_approve_minor_without_consent_returns_422() -> None:
    db = MagicMock()
    group_ref = MagicMock()
    group_ref.get.return_value.exists = True
    group_ref.get.return_value.to_dict.return_value = {"memberCount": 1, "memberCap": 20}
    jr_snap = MagicMock()
    jr_snap.exists = True
    jr_snap.to_dict.return_value = {
        "status": "pending",
        "requiresOwnerReview": True,
        "isMinor": True,
    }
    jr_ref = MagicMock()
    jr_ref.get.return_value = jr_snap

    def _subcol(name: str) -> MagicMock:
        sub = MagicMock()
        if name == "joinRequests":
            sub.document.return_value = jr_ref
        elif name == "members":
            sub.document.return_value = MagicMock()
        return sub

    group_ref.collection.side_effect = _subcol
    groups_col = MagicMock()
    groups_col.document.return_value = group_ref
    db.collection.return_value = groups_col

    with patch("app.routers.admin._db", return_value=db):
        res = TestClient(_owner_app()).post(
            "/api/admin/groups/g1/join-requests/minor/approve",
            json={"parentalConsentObtained": False, "parentalConsentNotes": ""},
            headers={"Authorization": "Bearer t"},
        )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "parental_consent_required"
    jr_ref.update.assert_not_called()


def test_owner_approve_refuses_non_minor_request_with_409() -> None:
    """If a request isn't owner-review (i.e. an adult's), owner endpoint refuses."""
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
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "not_a_minor_request"
