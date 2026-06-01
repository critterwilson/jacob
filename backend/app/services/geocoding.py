"""Forward geocoding via OpenStreetMap Nominatim (no paid API keys).

Used by the group meeting-address feature: when a leader sets or updates
a meeting address, the backend geocodes it once and caches `lat`/`lng` on
the group doc so the discover/map surface never geocodes per render.

Nominatim usage policy compliance:
- A descriptive `User-Agent` is sent on every request (configured via
  `Settings.nominatim_user_agent`). Nominatim rejects requests without one.
- Geocoding only happens on writes (address set/update), never on reads,
  so the ≤1 req/sec rate limit is comfortably respected at our volume.

Network access goes through the SSRF-guarded `safe_fetch` helper (the same
egress hardening used by the unfurl pipeline) so a poisoned
`nominatim_base_url` cannot be turned into an internal-network probe.

Failure is non-fatal: on any error the caller stores the address with
`lat`/`lng` = None and logs a warning rather than 500-ing.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from urllib.parse import urlencode

from app.config import get_settings
from app.services.safe_fetch import SafeFetchError, safe_fetch

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GeocodeResult:
    """A resolved lat/lng pair from a geocode lookup."""

    lat: float
    lng: float


def _build_query(
    *,
    street: str | None = None,
    city: str | None = None,
    state: str | None = None,
    postal_code: str | None = None,
    country: str | None = None,
    free_text: str | None = None,
) -> str:
    """Compose a single free-form `q` string from address parts.

    Nominatim's free-form `q` is more forgiving than the structured
    parameters when a field is missing, which is the common case for
    discover-by-postal-code or discover-by-query lookups.
    """
    if free_text:
        return free_text.strip()
    parts = [p.strip() for p in (street, city, state, postal_code, country) if p and p.strip()]
    return ", ".join(parts)


def geocode(
    *,
    street: str | None = None,
    city: str | None = None,
    state: str | None = None,
    postal_code: str | None = None,
    country: str | None = None,
    free_text: str | None = None,
) -> GeocodeResult | None:
    """Resolve an address (or free-text query) to a lat/lng, or None.

    Returns None — never raises — on an empty query, a no-result lookup,
    a network/transport error, or a malformed response. The caller treats
    None as "store the address without coordinates" so a flaky geocoder
    never blocks an address write.
    """
    query = _build_query(
        street=street,
        city=city,
        state=state,
        postal_code=postal_code,
        country=country,
        free_text=free_text,
    )
    if not query:
        return None

    settings = get_settings()
    base = (settings.nominatim_base_url or "").rstrip("/")
    if not base:
        logger.warning("geocode_skipped reason=no_base_url")
        return None

    url = f"{base}?{urlencode({'q': query, 'format': 'json', 'limit': 1})}"

    try:
        status_code, body, _content_type, _final = safe_fetch(
            url,
            max_bytes=256 * 1024,
            timeout_s=5.0,
            user_agent=settings.nominatim_user_agent,
        )
    except SafeFetchError as exc:
        logger.warning("geocode_fetch_failed code=%s", exc.code)
        return None

    if status_code != 200:
        logger.warning("geocode_bad_status status=%s", status_code)
        return None

    try:
        parsed = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        logger.warning("geocode_bad_json")
        return None

    if not isinstance(parsed, list) or not parsed:
        return None

    first = parsed[0]
    if not isinstance(first, dict):
        return None

    try:
        lat = float(first["lat"])
        lng = float(first["lon"])
    except (KeyError, TypeError, ValueError):
        logger.warning("geocode_missing_coords")
        return None

    return GeocodeResult(lat=lat, lng=lng)
