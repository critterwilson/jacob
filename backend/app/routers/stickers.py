"""Stickers router — M1 of the data-layer migration (Firestore → backend API).

Replaces the direct Firestore client read at `firestore.rules:444-447`. Returns
the seeded sticker catalogue as a flat list. Auth is required to match the
existing rule (`allow read: if isSignedIn();`).

Caching: the backend keeps an in-process cache of the sticker list keyed by
audience filter for `_CACHE_TTL_SECONDS`. Stickers are seeded once and only
change via admin tooling, so a stale read for a few minutes is acceptable.
A weak ETag derived from the cached payload is returned so the frontend can
do conditional-GET in a future iteration.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.deps import get_current_user
from app.errors import APIError
from app.models.stickers import Sticker, StickerListResponse
from app.models.user import CurrentUser
from app.services.firebase import get_firestore

logger = logging.getLogger(__name__)
router = APIRouter(tags=["stickers"])

_CACHE_TTL_SECONDS = 300.0
_AudienceFilter = str | None
_cache: dict[_AudienceFilter, tuple[float, StickerListResponse]] = {}


def _audience_key(audience: str | None) -> _AudienceFilter:
    if audience is None:
        return None
    return audience


def _etag_for(stickers: list[Sticker]) -> str:
    payload = json.dumps(
        [s.model_dump() for s in stickers],
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha1(payload.encode("utf-8"), usedforsecurity=False).hexdigest()
    return f'W/"{digest[:16]}"'


def _load_stickers(audience: str | None) -> StickerListResponse:
    db = get_firestore()
    query: Any = db.collection("stickers").order_by("order")
    if audience is not None:
        query = query.where("audience", "==", audience)

    snaps = list(query.stream())
    stickers: list[Sticker] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        slug = data.get("slug") or snap.id
        # Defensive: skip docs that lack required fields rather than 500.
        try:
            stickers.append(
                Sticker(
                    slug=slug,
                    name=data.get("name", ""),
                    audience=data.get("audience", "christian"),
                    order=int(data.get("order") or 0),
                    color=data.get("color", "#000000"),
                )
            )
        except Exception:  # noqa: BLE001
            logger.warning("sticker_skip_invalid slug=%s", slug)

    return StickerListResponse(stickers=stickers, etag=_etag_for(stickers))


def _cached_list(audience: str | None) -> StickerListResponse:
    key = _audience_key(audience)
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and (now - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]
    payload = _load_stickers(audience)
    _cache[key] = (now, payload)
    return payload


def _clear_cache() -> None:
    _cache.clear()


@router.get("/api/stickers", response_model=StickerListResponse)
def list_stickers(
    request: Request,
    response: Response,
    audience: str | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
) -> StickerListResponse:
    try:
        payload = _cached_list(audience)
    except Exception as exc:  # noqa: BLE001
        logger.exception("stickers_load_failed uid=%s", user.uid)
        raise APIError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="stickers_unavailable",
            message="Sticker catalogue is temporarily unavailable",
        ) from exc

    response.headers["ETag"] = payload.etag
    response.headers["Cache-Control"] = "private, max-age=300, stale-if-error=300"
    return payload
