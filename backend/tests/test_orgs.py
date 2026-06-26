"""Tests for the org router (T54).

Coverage:
- non-admin → 403 on platform-admin endpoints
- happy path: create + list + get
- slug uniqueness (409 on collision; reserved-slug rejection)
- get_org permits org members + org admins, denies strangers
- attach: idempotent re-attach, 409 on already-attached-elsewhere, sole-leader path,
  consent-required path issues a token + email + 409, valid-token path consumes
- detach: clears orgId, removes org member entries; 409 on not-attached
- admin add: idempotent, audited
- admin remove: refuses last admin (409), 404 on non-admin target
- dashboard aggregates groupCount + memberCount
- audience mismatch on attach
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.deps import get_current_user, require_admin, require_not_banned
from app.errors import http_exception_handler, validation_exception_handler
from app.middleware.rate_limit import limiter
from app.models.user import CurrentUser
from app.routers.orgs import router
from app.services import orgs as orgs_service


def _user(uid: str = "u1", *, is_admin: bool = False) -> CurrentUser:
    return CurrentUser(
        uid=uid,
        email=f"{uid}@example.com",
        claims={"admin": True} if is_admin else {},
    )


def _app(
    *,
    user: CurrentUser,
    is_platform_admin: bool = False,
) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(HTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_banned] = lambda: user
    if is_platform_admin:
        app.dependency_overrides[require_admin] = lambda: user
    else:

        def _forbid() -> CurrentUser:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": {
                        "code": "forbidden",
                        "message": "Admin privileges required",
                        "details": {},
                    }
                },
            )

        app.dependency_overrides[require_admin] = _forbid
    return app


# ── DB fixture ────────────────────────────────────────────────────────────────


class FakeFirestore:
    """Minimal in-memory Firestore stand-in good enough for the org router.

    Models the subset of the Admin SDK we touch: collection().document()
    set/get/update/delete + collection().where().stream() + batch + transaction.
    """

    def __init__(self) -> None:
        # path -> doc dict
        self.docs: dict[str, dict[str, Any]] = {}

    # ── factories ──
    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, [name])

    def collection_group(self, name: str) -> FakeCollectionGroup:
        return FakeCollectionGroup(self, name)

    def batch(self) -> FakeBatch:
        return FakeBatch(self)

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self)

    # ── helpers ──
    def _path(self, parts: list[str]) -> str:
        return "/".join(parts)

    def _doc_get(self, path: str) -> dict[str, Any] | None:
        return self.docs.get(path)

    def _doc_set(self, path: str, data: dict[str, Any]) -> None:
        self.docs[path] = dict(data)

    def _doc_update(self, path: str, data: dict[str, Any]) -> None:
        existing = self.docs.get(path) or {}
        existing.update(data)
        self.docs[path] = existing

    def _doc_delete(self, path: str) -> None:
        self.docs.pop(path, None)

    def _coll_iter(self, parts: list[str]) -> list[tuple[str, dict[str, Any]]]:
        prefix = "/".join(parts) + "/"
        out = []
        for path, data in self.docs.items():
            if path.startswith(prefix):
                rest = path[len(prefix) :]
                if "/" not in rest:
                    out.append((rest, data))
        out.sort()
        return out


class FakeSnapshot:
    def __init__(
        self,
        doc_id: str,
        data: dict[str, Any] | None,
        reference: FakeDocRef | None = None,
    ) -> None:
        self.id = doc_id
        self._data = data
        self.exists = data is not None
        # `reference` matches the real google-cloud-firestore Snapshot API
        # — collection-group queries rely on `snap.reference.parent.parent`
        # to find the containing doc.
        self.reference = reference

    def to_dict(self) -> dict[str, Any] | None:
        return None if self._data is None else dict(self._data)

    def get(self, key: str) -> Any:
        return (self._data or {}).get(key)


class FakeDocRef:
    def __init__(self, fs: FakeFirestore, parts: list[str]) -> None:
        self._fs = fs
        self._parts = parts
        self._path = "/".join(parts)
        self.id = parts[-1]

    @property
    def parent(self) -> FakeCollection:
        return FakeCollection(self._fs, self._parts[:-1])

    def get(self) -> FakeSnapshot:
        data = self._fs._doc_get(self._path)
        return FakeSnapshot(self.id, data, reference=self)

    def set(
        self,
        data: dict[str, Any],
        merge: bool = False,
    ) -> None:
        if merge and self._path in self._fs.docs:
            self._fs._doc_update(self._path, data)
        else:
            self._fs._doc_set(self._path, data)

    def create(self, data: dict[str, Any]) -> None:
        if self._path in self._fs.docs:
            raise RuntimeError(f"already exists: {self._path}")
        self._fs._doc_set(self._path, data)

    def update(self, data: dict[str, Any]) -> None:
        self._fs._doc_update(self._path, data)

    def delete(self) -> None:
        self._fs._doc_delete(self._path)

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self._fs, self._parts + [name])


class FakeQuery:
    def __init__(
        self,
        fs: FakeFirestore,
        parts: list[str],
        filters: list[tuple[str, str, Any]],
    ) -> None:
        self._fs = fs
        self._parts = parts
        self._filters = filters

    def where(self, field: str, op: str, value: Any) -> FakeQuery:
        return FakeQuery(self._fs, self._parts, self._filters + [(field, op, value)])

    def stream(self) -> Any:
        for doc_id, data in self._fs._coll_iter(self._parts):
            if all(self._match(data, f, op, v) for f, op, v in self._filters):
                yield FakeSnapshot(
                    doc_id,
                    data,
                    reference=FakeDocRef(self._fs, self._parts + [doc_id]),
                )

    @staticmethod
    def _match(data: dict[str, Any], field: str, op: str, value: Any) -> bool:
        # Dotted paths walk into nested maps, matching real Firestore.
        cur: Any = data
        for part in field.split("."):
            if isinstance(cur, dict):
                cur = cur.get(part)
            else:
                cur = None
                break
        v = cur
        if op == "==":
            return v == value
        if op == "in":
            # Real Firestore `in` matches when `v` is equal to any of the
            # values in the list. A missing field never matches.
            return v is not None and v in value
        if v is None:
            return False
        if op == "<":
            return bool(v < value)
        if op == "<=":
            return bool(v <= value)
        if op == ">":
            return bool(v > value)
        if op == ">=":
            return bool(v >= value)
        return False


class FakeCollection(FakeQuery):
    def __init__(self, fs: FakeFirestore, parts: list[str]) -> None:
        super().__init__(fs, parts, [])

    def document(self, doc_id: str) -> FakeDocRef:
        return FakeDocRef(self._fs, self._parts + [doc_id])

    @property
    def parent(self) -> FakeDocRef | None:
        # The members collection at `groups/{gid}/members` has
        # `parent == groups/{gid}`. Top-level collections have no parent.
        if len(self._parts) <= 1:
            return None
        return FakeDocRef(self._fs, self._parts[:-1])


class FakeCollectionGroup:
    """Iterate every doc whose immediate parent collection is `name`.

    Real Firestore `collection_group(x)` matches docs anywhere in the tree
    whose containing collection segment equals `x`. For example,
    `collection_group("members")` returns docs at `groups/{gid}/members/{uid}`
    as well as any other path ending in `/members/{doc_id}`.
    """

    def __init__(self, fs: FakeFirestore, name: str) -> None:
        self._fs = fs
        self._name = name
        self._filters: list[tuple[str, str, Any]] = []

    def where(self, field: str, op: str, value: Any) -> FakeCollectionGroup:
        clone = FakeCollectionGroup(self._fs, self._name)
        clone._filters = self._filters + [(field, op, value)]
        return clone

    def stream(self) -> Any:
        for path, data in self._fs.docs.items():
            segments = path.split("/")
            # Need at least `<collection>/<doc>`; the collection segment
            # is the second-to-last (length-2 index from the end).
            if len(segments) < 2 or segments[-2] != self._name:
                continue
            if all(FakeQuery._match(data, f, op, v) for f, op, v in self._filters):
                yield FakeSnapshot(
                    segments[-1],
                    data,
                    reference=FakeDocRef(self._fs, segments),
                )


class FakeBatch:
    def __init__(self, fs: FakeFirestore) -> None:
        self._fs = fs
        self._ops: list[Any] = []

    def set(self, ref: FakeDocRef, data: dict[str, Any]) -> None:
        self._ops.append(("set", ref, data))

    def update(self, ref: FakeDocRef, data: dict[str, Any]) -> None:
        self._ops.append(("update", ref, data))

    def delete(self, ref: FakeDocRef) -> None:
        self._ops.append(("delete", ref))

    def commit(self) -> None:
        for op in self._ops:
            if op[0] == "set":
                op[1].set(op[2])
            elif op[0] == "update":
                op[1].update(op[2])
            elif op[0] == "delete":
                op[1].delete()
        self._ops.clear()


class FakeTransaction:
    """Honors the @gcf.transactional contract with a single sequential pass.

    Good enough for tests; real Firestore transactions retry on conflict.
    """

    def __init__(self, fs: FakeFirestore) -> None:
        self._fs = fs

    def get(self, ref_or_query: Any) -> Any:
        # Real Firestore transactions accept either a DocumentReference
        # (returns a snapshot) or a Query/CollectionReference (returns an
        # iterator of snapshots). FakeQuery has `stream`; FakeDocRef does not.
        if hasattr(ref_or_query, "stream"):
            return ref_or_query.stream()
        return ref_or_query.get()

    def set(self, ref: FakeDocRef, data: dict[str, Any]) -> None:
        ref.set(data)

    def update(self, ref: FakeDocRef, data: dict[str, Any]) -> None:
        ref.update(data)

    def delete(self, ref: FakeDocRef) -> None:
        ref.delete()


def _patch_transactional() -> Any:
    """Replace `gcf.transactional` so the decorator does not require a real Firestore client."""

    def passthrough(fn: Any) -> Any:
        def wrapper(txn: Any, *args: Any, **kwargs: Any) -> Any:
            return fn(txn, *args, **kwargs)

        return wrapper

    return passthrough


# ── tests ─────────────────────────────────────────────────────────────────────


def _seed_org(
    fs: FakeFirestore,
    *,
    org_id: str,
    slug: str = "pilot",
    audience: str = "christian",
    admins: list[str] | None = None,
    members: list[tuple[str, list[str]]] | None = None,
) -> None:
    fs._doc_set(
        f"orgs/{org_id}",
        {
            "name": "Pilot Church",
            "slug": slug,
            "description": "",
            "audience": audience,
            "logoUrl": None,
            "primaryColor": None,
            "customDomain": None,
            "customSubdomain": None,
            "createdBy": "platform-admin",
            "createdAt": datetime.now(UTC),
            "schemaVersion": 1,
            "billing": {"tier": "free", "customerId": None, "status": "active"},
            "llmModerationPolicy": "off",
            "threadSummaryEnabled": False,
            "semanticSearchEnabled": False,
            "prayerClusteringEnabled": False,
            "transparencyReportEnabled": False,
        },
    )
    fs._doc_set(f"org_slugs/{slug}", {"orgId": org_id, "createdAt": datetime.now(UTC)})
    for admin in admins or []:
        fs._doc_set(
            f"orgs/{org_id}/admins/{admin}",
            {"addedBy": "system", "addedAt": datetime.now(UTC)},
        )
    for uid, group_ids in members or []:
        fs._doc_set(
            f"orgs/{org_id}/members/{uid}",
            {"joinedAt": datetime.now(UTC), "groupIds": list(group_ids)},
        )


def _seed_group(
    fs: FakeFirestore,
    *,
    gid: str,
    leaders: list[str],
    members: list[str] | None = None,
    org_id: str | None = None,
    sticker_set: str = "christian",
) -> None:
    members = list(set((members or []) + leaders))
    fs._doc_set(
        f"groups/{gid}",
        {
            "name": f"Group {gid}",
            "stickerSet": sticker_set,
            "memberCount": len(members),
            "orgId": org_id,
            "createdAt": datetime.now(UTC),
        },
    )
    for uid in members:
        role = "leader" if uid in leaders else "member"
        fs._doc_set(
            f"groups/{gid}/members/{uid}",
            {"role": role, "uid": uid, "joinedAt": datetime.now(UTC)},
        )


def test_create_org_non_admin_403() -> None:
    user = _user("u1")
    res = TestClient(_app(user=user, is_platform_admin=False)).post(
        "/api/orgs",
        json={
            "name": "Pilot",
            "slug": "pilot",
            "description": "",
            "audience": "christian",
            "initialAdminUid": "admin-1",
        },
    )
    assert res.status_code == 403


def test_create_org_happy_path() -> None:
    fs = FakeFirestore()
    user = _user("platform-admin", is_admin=True)

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user, is_platform_admin=True)).post(
            "/api/orgs",
            json={
                "name": "Pilot Church",
                "slug": "pilot-church",
                "description": "Our pilot",
                "audience": "christian",
                "initialAdminUid": "admin-1",
            },
        )
    assert res.status_code == 201, res.text
    body = res.json()
    org_id = body["orgId"]
    assert body["slug"] == "pilot-church"
    assert fs._doc_get(f"orgs/{org_id}") is not None
    assert fs._doc_get(f"orgs/{org_id}/admins/admin-1") is not None
    assert fs._doc_get("org_slugs/pilot-church") == {
        "orgId": org_id,
        "createdAt": fs._doc_get("org_slugs/pilot-church")["createdAt"],
    }


def test_create_org_slug_collision_409() -> None:
    fs = FakeFirestore()
    fs._doc_set("org_slugs/taken", {"orgId": "existing", "createdAt": datetime.now(UTC)})
    user = _user("platform-admin", is_admin=True)

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user, is_platform_admin=True)).post(
            "/api/orgs",
            json={
                "name": "X",
                "slug": "taken",
                "description": "",
                "audience": "christian",
                "initialAdminUid": "admin-1",
            },
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "slug_taken"


def test_create_org_reserved_slug_rejected() -> None:
    fs = FakeFirestore()
    user = _user("platform-admin", is_admin=True)

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user, is_platform_admin=True)).post(
            "/api/orgs",
            json={
                "name": "X",
                "slug": "api",
                "description": "",
                "audience": "christian",
                "initialAdminUid": "admin-1",
            },
        )
    # `api` is in RESERVED_SLUGS — reserve_slug returns False → service raises slug_taken
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "slug_taken"


def test_get_org_permits_member() -> None:
    fs = FakeFirestore()
    _seed_org(
        fs,
        org_id="o1",
        admins=["admin-1"],
        members=[("member-1", ["g1"])],
    )
    user = _user("member-1")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/o1")
    assert res.status_code == 200
    assert res.json()["orgId"] == "o1"


def test_get_org_denies_stranger() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    user = _user("stranger")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/o1")
    assert res.status_code == 403


def test_get_org_404_when_missing() -> None:
    fs = FakeFirestore()
    user = _user("u1")
    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/nope")
    assert res.status_code == 404


def test_attach_group_sole_leader_path() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    _seed_group(fs, gid="g1", leaders=["admin-1"], members=["m1", "m2"])
    user = _user("admin-1")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
        patch("firebase_admin.firestore.ArrayUnion", lambda items: {"_arrayUnion": items}),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/groups/g1/attach",
            json={},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["consentRequired"] is False
    assert fs._doc_get("groups/g1")["orgId"] == "o1"
    # Org-member entries written for all three members
    assert fs._doc_get("orgs/o1/members/admin-1") is not None
    assert fs._doc_get("orgs/o1/members/m1") is not None
    assert fs._doc_get("orgs/o1/members/m2") is not None


def test_attach_group_consent_required_path_sends_email() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    _seed_group(fs, gid="g1", leaders=["someone-else"], members=["m1"])
    fs._doc_set("users/someone-else", {"email": "leader@example.com", "displayName": "Leader"})
    user = _user("admin-1")

    sent: list[dict[str, Any]] = []

    def fake_send_email(**kwargs: Any) -> None:
        sent.append(kwargs)

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch("app.routers.orgs.send_email", side_effect=fake_send_email),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/groups/g1/attach",
            json={},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["consentRequired"] is True
    assert body["consentLinkSent"] is True
    assert sent and sent[0]["to_email"] == "leader@example.com"
    # Group is NOT yet attached
    assert fs._doc_get("groups/g1").get("orgId") is None
    # A consent token is in the table
    tokens = [k for k in fs.docs.keys() if k.startswith("org_consent_tokens/")]
    assert len(tokens) == 1


def test_attach_group_with_valid_consent_token() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    _seed_group(fs, gid="g1", leaders=["leader-1"], members=["m1"])
    token = "tok-abc"
    fs._doc_set(
        f"org_consent_tokens/{token}",
        {
            "orgId": "o1",
            "gid": "g1",
            "issuedTo": "leader-1",
            "issuedBy": "admin-1",
            "expiresAt": datetime.now(UTC) + timedelta(minutes=30),
            "consumedAt": None,
        },
    )
    user = _user("admin-1")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch("google.cloud.firestore.transactional", _patch_transactional()),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
        patch("firebase_admin.firestore.ArrayUnion", lambda items: {"_arrayUnion": items}),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/groups/g1/attach",
            json={"consentToken": token},
        )
    assert res.status_code == 200, res.text
    assert res.json()["consentRequired"] is False
    assert fs._doc_get("groups/g1")["orgId"] == "o1"
    # Token consumed
    assert fs._doc_get(f"org_consent_tokens/{token}").get("consumedAt") is not None


def test_attach_idempotent_when_already_attached_to_same_org() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    _seed_group(fs, gid="g1", leaders=["leader-1"], org_id="o1")
    user = _user("admin-1")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/groups/g1/attach",
            json={},
        )
    assert res.status_code == 200
    assert res.json()["consentRequired"] is False


def test_attach_409_when_attached_elsewhere() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    _seed_group(fs, gid="g1", leaders=["leader-1"], org_id="other-org")
    user = _user("admin-1")

    with (patch("app.routers.orgs._db", return_value=fs),):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/groups/g1/attach",
            json={},
        )
    assert res.status_code == 409


def test_attach_audience_mismatch() -> None:
    # A non-"general" org only absorbs groups whose sticker set matches its
    # audience; here a christian org rejects a general-audience group.
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"], audience="christian")
    _seed_group(fs, gid="g1", leaders=["admin-1"], sticker_set="general")
    user = _user("admin-1")
    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/groups/g1/attach",
            json={},
        )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "audience_mismatch"


def test_detach_group_clears_org_id_and_members() -> None:
    fs = FakeFirestore()
    _seed_org(
        fs,
        org_id="o1",
        admins=["admin-1"],
        members=[("m1", ["g1"]), ("m2", ["g1", "g2"])],
    )
    _seed_group(fs, gid="g1", leaders=["admin-1"], members=["m1", "m2"], org_id="o1")
    user = _user("admin-1")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
    ):
        res = TestClient(_app(user=user)).post(
            "/api/orgs/o1/groups/g1/detach",
        )
    assert res.status_code == 200
    assert fs._doc_get("groups/g1")["orgId"] is None
    # m1 only had g1 → removed entirely.
    assert fs._doc_get("orgs/o1/members/m1") is None
    # m2 had g1 + g2 → only g1 pulled.
    assert fs._doc_get("orgs/o1/members/m2")["groupIds"] == ["g2"]


def test_admin_add_idempotent() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    user = _user("admin-1")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch.object(__import__("firebase_admin").firestore, "SERVER_TIMESTAMP", datetime.now(UTC)),
    ):
        first = TestClient(_app(user=user)).post(
            "/api/orgs/o1/admins",
            json={"uid": "admin-2"},
        )
        second = TestClient(_app(user=user)).post(
            "/api/orgs/o1/admins",
            json={"uid": "admin-2"},
        )
    assert first.status_code == 200
    assert first.json()["added"] is True
    assert second.status_code == 200
    assert second.json()["added"] is False


def test_admin_remove_refuses_last_admin() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1"])
    user = _user("admin-1")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("google.cloud.firestore.transactional", _patch_transactional()),
    ):
        res = TestClient(_app(user=user)).delete("/api/orgs/o1/admins/admin-1")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "last_admin"


def test_remove_admin_re_reads_admins_through_transaction() -> None:
    """H-BACK-1: the admin-count check must run inside the txn.

    Simulate a concurrent race by feeding the txn-scoped query a stale
    view that has dropped to one admin, even though the bare collection
    still returns two. If `remove_admin` reads through the transaction
    (the correctness invariant), it sees count=1 and refuses; if it
    reads outside, it sees count=2 and brick-deletes the last admin.
    """
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1", "admin-2"])

    txn_get_args: list[Any] = []

    class RacingTxn:
        def get(self, ref_or_query: Any) -> Any:
            txn_get_args.append(ref_or_query)
            if hasattr(ref_or_query, "stream"):
                # One admin only — as if a concurrent remove had
                # already committed during this transaction's window.
                return iter([FakeSnapshot("admin-2", {"addedBy": "x"})])
            return ref_or_query.get()

        def delete(self, ref: Any) -> None:
            ref.delete()

    racing_txn = RacingTxn()

    class RacingDB:
        def __init__(self, inner: FakeFirestore) -> None:
            self._inner = inner

        def collection(self, name: str) -> Any:
            return self._inner.collection(name)

        def transaction(self) -> Any:
            return racing_txn

    with patch("google.cloud.firestore.transactional", _patch_transactional()):
        ok, reason = orgs_service.remove_admin(
            RacingDB(fs),
            org_id="o1",
            uid="admin-1",
        )

    assert (ok, reason) == (False, "last_admin")
    # The admin-count query was issued through the txn (a query has .stream).
    assert any(hasattr(arg, "stream") for arg in txn_get_args)
    # And the doc was *not* deleted — the txn refused.
    assert fs._doc_get("orgs/o1/admins/admin-1") is not None


def test_admin_remove_404_for_non_admin_target() -> None:
    fs = FakeFirestore()
    _seed_org(fs, org_id="o1", admins=["admin-1", "admin-2"])
    user = _user("admin-1")

    with (
        patch("app.routers.orgs._db", return_value=fs),
        patch("app.services.audit._db", return_value=fs),
        patch("google.cloud.firestore.transactional", _patch_transactional()),
    ):
        res = TestClient(_app(user=user)).delete("/api/orgs/o1/admins/stranger")
    assert res.status_code == 404


def test_dashboard_aggregates_groups_and_members() -> None:
    fs = FakeFirestore()
    _seed_org(
        fs,
        org_id="o1",
        admins=["admin-1"],
        members=[("m1", ["g1"]), ("m2", ["g1", "g2"]), ("m3", ["g2"])],
    )
    _seed_group(fs, gid="g1", leaders=["admin-1"], members=["m1", "m2"], org_id="o1")
    _seed_group(fs, gid="g2", leaders=["admin-1"], members=["m2", "m3"], org_id="o1")
    user = _user("admin-1")

    with patch("app.routers.orgs._db", return_value=fs):
        res = TestClient(_app(user=user)).get("/api/orgs/o1/dashboard")
    assert res.status_code == 200
    body = res.json()
    assert body["groupCount"] == 2
    assert body["memberCount"] == 3
    assert body["pendingModerationCount"] == 0


def test_consume_consent_token_expired() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "org_consent_tokens/expired-tok",
        {
            "orgId": "o1",
            "gid": "g1",
            "issuedTo": "leader-1",
            "issuedBy": "admin-1",
            "expiresAt": datetime.now(UTC) - timedelta(minutes=1),
            "consumedAt": None,
        },
    )

    with patch("google.cloud.firestore.transactional", _patch_transactional()):
        ok, reason = orgs_service.consume_consent_token(
            fs,
            token="expired-tok",
            org_id="o1",
            gid="g1",
        )
    assert ok is False
    assert reason == "expired"


def test_consume_consent_token_mismatch() -> None:
    fs = FakeFirestore()
    fs._doc_set(
        "org_consent_tokens/tok",
        {
            "orgId": "o1",
            "gid": "g1",
            "issuedTo": "leader-1",
            "issuedBy": "admin-1",
            "expiresAt": datetime.now(UTC) + timedelta(minutes=10),
            "consumedAt": None,
        },
    )
    with patch("google.cloud.firestore.transactional", _patch_transactional()):
        ok, reason = orgs_service.consume_consent_token(
            fs,
            token="tok",
            org_id="other-org",
            gid="g1",
        )
    assert ok is False
    assert reason == "mismatch"
