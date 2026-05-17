"""Tests for the auth dependency layer.

`firebase_admin.auth.verify_id_token` and `init_firebase_admin` are
mocked at the module level so tests don't hit Google's certificate
endpoints.
"""

from __future__ import annotations

import base64
import json
import time
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


def test_unexpected_verifier_error_emits_warning_log(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """L3 — JWKS / transport / clock-skew failures must log a warning so
    Sentry can distinguish a Google outage from an invalid-token spike."""
    with _patch_verify(side_effect=RuntimeError("jwks fetch failed")):
        with caplog.at_level("WARNING", logger="app.deps"):
            client.get("/me", headers={"Authorization": "Bearer t"})
    matched = [r for r in caplog.records if "verify_id_token_failed" in r.message]
    assert matched, "expected verify_id_token_failed warning log line"
    assert "jwks fetch failed" in matched[0].message


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


# ── emulator-token fallback ─────────────────────────────────────────────────


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _make_emulator_jwt(
    project: str = "demo-jacob",
    uid: str = "emu-uid",
    *,
    alg: str = "none",
    aud: str | None = None,
    iss: str | None = None,
    exp: int | None = None,
    extra: dict[str, object] | None = None,
) -> str:
    header = _b64url(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    payload_dict: dict[str, object] = {
        "iss": iss if iss is not None else f"https://securetoken.google.com/{project}",
        "aud": aud if aud is not None else project,
        "auth_time": int(time.time()) - 60,
        "user_id": uid,
        "sub": uid,
        "iat": int(time.time()) - 60,
        "exp": exp if exp is not None else int(time.time()) + 3600,
        "email": f"{uid}@example.com",
        "email_verified": True,
        "firebase": {"identities": {}, "sign_in_provider": "password"},
    }
    if extra:
        payload_dict.update(extra)
    payload = _b64url(json.dumps(payload_dict).encode())
    # Real emulator tokens append an empty signature segment.
    return f"{header}.{payload}."


@pytest.fixture
def emulator_app() -> Iterator[tuple[TestClient, object]]:
    """Set up a TestClient with `firebase_admin.get_app().project_id` mocked
    so the emulator-fallback path can read a project ID without booting the
    real Admin SDK.
    """
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)

    @app.get("/me")
    def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, object]:
        return {"uid": user.uid, "email": user.email}

    class _StubApp:
        project_id = "demo-jacob"

    with patch("firebase_admin.get_app", return_value=_StubApp()):
        with patch("app.deps.init_firebase_admin"):
            yield TestClient(app), _StubApp()


def _settings_with(allow_emulator: bool) -> object:
    class _S:
        jacob_allow_emulator_tokens = allow_emulator

    return _S()


def test_emulator_token_rejected_when_flag_off(emulator_app) -> None:  # type: ignore[no-untyped-def]
    client, _stub = emulator_app
    token = _make_emulator_jwt()
    with patch(
        "app.deps.firebase_auth.verify_id_token",
        side_effect=firebase_auth.InvalidIdTokenError("nope"),
    ):
        with patch("app.deps.get_settings", return_value=_settings_with(False)):
            res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_emulator_token_accepted_when_flag_on(emulator_app) -> None:  # type: ignore[no-untyped-def]
    client, _stub = emulator_app
    token = _make_emulator_jwt(uid="staging-uid-123")
    with patch(
        "app.deps.firebase_auth.verify_id_token",
        side_effect=firebase_auth.InvalidIdTokenError("emulator unsigned"),
    ):
        with patch("app.deps.get_settings", return_value=_settings_with(True)):
            res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["uid"] == "staging-uid-123"
    assert body["email"] == "staging-uid-123@example.com"


def test_emulator_path_rejects_rs256_alg(emulator_app) -> None:  # type: ignore[no-untyped-def]
    """Real Firebase tokens are RS256. If verify_id_token rejected one (e.g.
    tampered signature), the fallback must NOT accept it just because the
    flag is on. Only alg=none survives the fallback.
    """
    client, _stub = emulator_app
    token = _make_emulator_jwt(alg="RS256")
    with patch(
        "app.deps.firebase_auth.verify_id_token",
        side_effect=firebase_auth.InvalidIdTokenError("bad sig"),
    ):
        with patch("app.deps.get_settings", return_value=_settings_with(True)):
            res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_emulator_path_rejects_wrong_aud(emulator_app) -> None:  # type: ignore[no-untyped-def]
    client, _stub = emulator_app
    token = _make_emulator_jwt(aud="some-other-project")
    with patch(
        "app.deps.firebase_auth.verify_id_token",
        side_effect=firebase_auth.InvalidIdTokenError("emu"),
    ):
        with patch("app.deps.get_settings", return_value=_settings_with(True)):
            res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_emulator_path_rejects_expired(emulator_app) -> None:  # type: ignore[no-untyped-def]
    client, _stub = emulator_app
    token = _make_emulator_jwt(exp=int(time.time()) - 10)
    with patch(
        "app.deps.firebase_auth.verify_id_token",
        side_effect=firebase_auth.InvalidIdTokenError("emu"),
    ):
        with patch("app.deps.get_settings", return_value=_settings_with(True)):
            res = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_emulator_path_does_not_run_when_real_verify_succeeds(
    emulator_app,
) -> None:  # type: ignore[no-untyped-def]
    """If verify_id_token returns a payload, the emulator path is never
    consulted, even with the flag on. Guard against a refactor that flips
    the order of the two paths.
    """
    client, _stub = emulator_app
    with patch(
        "app.deps.firebase_auth.verify_id_token",
        return_value={"uid": "real-uid", "email": "real@example.com"},
    ):
        with patch("app.deps.get_settings", return_value=_settings_with(True)):
            res = client.get("/me", headers={"Authorization": "Bearer real"})
    assert res.status_code == 200
    assert res.json()["uid"] == "real-uid"
