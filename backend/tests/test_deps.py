"""Tests for the auth dependency layer.

`firebase_admin.auth.verify_id_token` and `init_firebase_admin` are
mocked at the module level so tests don't hit Google's certificate
endpoints.
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import patch

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from firebase_admin import auth as firebase_auth

from app.deps import get_current_user, require_admin
from app.errors import http_exception_handler
from app.models.user import CurrentUser


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)

    @app.get("/me")
    def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, object]:
        return {"uid": user.uid, "email": user.email}

    @app.get("/admin")
    def admin(user: CurrentUser = Depends(require_admin)) -> dict[str, str]:
        return {"uid": user.uid}

    yield TestClient(app)


def _patch_verify(return_value: object | None = None, side_effect: object | None = None):
    """Patch verify_id_token + the SDK init together."""
    patches = [
        patch("app.deps.init_firebase_admin"),
        patch("app.deps.firebase_auth.verify_id_token"),
    ]

    class _Ctx:
        def __enter__(self) -> object:
            self._init = patches[0].__enter__()
            self._verify = patches[1].__enter__()
            if side_effect is not None:
                self._verify.side_effect = side_effect
            else:
                self._verify.return_value = return_value
            return self._verify

        def __exit__(self, *exc: object) -> None:
            patches[1].__exit__(*exc)
            patches[0].__exit__(*exc)

    return _Ctx()


def test_missing_authorization_header(client: TestClient) -> None:
    res = client.get("/me")
    assert res.status_code == 401
    body = res.json()
    assert body["error"]["code"] == "unauthenticated"
    assert "Missing" in body["error"]["message"]


def test_malformed_authorization_header(client: TestClient) -> None:
    res = client.get("/me", headers={"Authorization": "Basic foo"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_empty_bearer_token(client: TestClient) -> None:
    res = client.get("/me", headers={"Authorization": "Bearer "})
    assert res.status_code == 401


def test_valid_token_returns_current_user(client: TestClient) -> None:
    with _patch_verify(return_value={"uid": "alice", "email": "alice@example.com", "admin": False}):
        res = client.get("/me", headers={"Authorization": "Bearer valid-token"})
    assert res.status_code == 200
    assert res.json() == {"uid": "alice", "email": "alice@example.com"}


def test_valid_token_without_email(client: TestClient) -> None:
    with _patch_verify(return_value={"uid": "anon-uid"}):
        res = client.get("/me", headers={"Authorization": "Bearer t"})
    assert res.status_code == 200
    assert res.json() == {"uid": "anon-uid", "email": None}


def test_expired_token_returns_401(client: TestClient) -> None:
    with _patch_verify(side_effect=firebase_auth.ExpiredIdTokenError("expired", cause=None)):
        res = client.get("/me", headers={"Authorization": "Bearer t"})
    assert res.status_code == 401
    assert res.json()["error"]["message"] == "Token expired"


def test_invalid_token_returns_401(client: TestClient) -> None:
    with _patch_verify(side_effect=firebase_auth.InvalidIdTokenError("nope")):
        res = client.get("/me", headers={"Authorization": "Bearer t"})
    assert res.status_code == 401
    assert res.json()["error"]["message"] == "Invalid token"


def test_unexpected_verifier_error_returns_401(client: TestClient) -> None:
    with _patch_verify(side_effect=RuntimeError("boom")):
        res = client.get("/me", headers={"Authorization": "Bearer t"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_non_admin_forbidden(client: TestClient) -> None:
    with _patch_verify(return_value={"uid": "alice", "admin": False}):
        res = client.get("/admin", headers={"Authorization": "Bearer t"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_admin_claim_allows_access(client: TestClient) -> None:
    with _patch_verify(return_value={"uid": "alice", "admin": True}):
        res = client.get("/admin", headers={"Authorization": "Bearer t"})
    assert res.status_code == 200
    assert res.json() == {"uid": "alice"}


def test_admin_truthy_value_does_not_count(client: TestClient) -> None:
    """`admin: 1` (truthy but not True) must NOT grant admin access."""
    with _patch_verify(return_value={"uid": "alice", "admin": 1}):
        res = client.get("/admin", headers={"Authorization": "Bearer t"})
    assert res.status_code == 403
