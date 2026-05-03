"""JWT-based one-click unsubscribe tokens (T35, RFC 8058).

Tokens are HS256-signed JWTs containing `{uid, kind}`. They expire in 90
days. Token rotation invalidates old tokens immediately — acceptable since
the next digest email will contain a fresh token.

No database read on unsubscribe: the token is the auth.

Supported `kind` values: "digest" (more may be added in Phase 3).
"""

from __future__ import annotations

import hmac
import json
import logging
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from typing import Literal

from app.config import get_settings

logger = logging.getLogger(__name__)

UnsubscribeKind = Literal["digest"]
TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60  # 90 days


def _b64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = (4 - len(s) % 4) % 4
    return urlsafe_b64decode(s + "=" * pad)


def _sign(header_b64: str, payload_b64: str, secret: str) -> str:
    message = f"{header_b64}.{payload_b64}".encode()
    sig = hmac.new(secret.encode(), message, "sha256").digest()
    return _b64url(sig)


def mint_unsubscribe_token(uid: str, kind: UnsubscribeKind) -> str:
    """Return a compact HS256 JWT for the given (uid, kind) pair."""
    settings = get_settings()
    if not settings.jwt_unsubscribe_secret:
        raise RuntimeError("JWT_UNSUBSCRIBE_SECRET not configured")

    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(
        json.dumps({"uid": uid, "kind": kind, "exp": int(time.time()) + TOKEN_TTL_SECONDS}).encode()
    )
    sig = _sign(header, payload, settings.jwt_unsubscribe_secret)
    return f"{header}.{payload}.{sig}"


def verify_unsubscribe_token(token: str) -> tuple[str, UnsubscribeKind]:
    """Return (uid, kind) or raise ValueError if token is invalid/expired."""
    settings = get_settings()
    if not settings.jwt_unsubscribe_secret:
        raise RuntimeError("JWT_UNSUBSCRIBE_SECRET not configured")

    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("malformed token")

    header_b64, payload_b64, provided_sig = parts
    expected_sig = _sign(header_b64, payload_b64, settings.jwt_unsubscribe_secret)
    if not hmac.compare_digest(provided_sig, expected_sig):
        raise ValueError("invalid signature")

    try:
        claims = json.loads(_b64url_decode(payload_b64))
    except Exception as exc:
        raise ValueError("malformed payload") from exc

    if int(time.time()) > claims.get("exp", 0):
        raise ValueError("token expired")

    uid = claims.get("uid")
    kind = claims.get("kind")
    if not uid or kind not in ("digest",):
        raise ValueError("invalid claims")

    return str(uid), kind
