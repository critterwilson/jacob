"""Sermon-archive helpers (T52).

Two pure helpers + a YouTube oEmbed fetch. The oEmbed call is the
only T52 surface that touches the network; we cap it tight (5s
timeout, allowlist youtube.com / youtu.be hosts only) so it can't
be turned into a general-purpose SSRF egress hop. T53 introduces a
shared `safe_fetch` and the unfurl service migrates onto it; the
sermon path stays YouTube-only.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


_YOUTUBE_HOSTS = {"www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"}
_YT_VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,15}$")


def detect_source_type(url: str) -> str:
    """Return 'youtube' / 'podcast' / 'other' based on the URL.

    Podcast detection is best-effort: the typical RSS / Apple-podcast
    URLs end in `.rss` or live under `podcasts.apple.com`. Anything
    else falls through to `other`.
    """
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return "other"
    host = (parsed.hostname or "").lower()
    if host in _YOUTUBE_HOSTS:
        return "youtube"
    # CodeQL py/incomplete-url-substring-sanitization: compare the host
    # with `==` + a leading-dot subdomain check rather than a bare
    # endswith. Not strictly security-sensitive here (we only pick a
    # display category), but the safe pattern is no more code.
    if host == "podcasts.apple.com" or host.endswith(".podcasts.apple.com"):
        return "podcast"
    if parsed.path.endswith(".rss"):
        return "podcast"
    return "other"


def youtube_video_id(url: str) -> str | None:
    """Extract the YouTube video id from a watch URL or short URL."""
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return None
    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
    else:
        if parsed.path == "/watch":
            qs = parse_qs(parsed.query)
            v = qs.get("v") or []
            candidate = v[0] if v else ""
        elif parsed.path.startswith("/embed/"):
            candidate = parsed.path.split("/", 2)[2].split("/")[0]
        elif parsed.path.startswith("/shorts/"):
            candidate = parsed.path.split("/", 2)[2].split("/")[0]
        else:
            return None
    if candidate and _YT_VIDEO_ID_RE.match(candidate):
        return candidate
    return None


def fetch_youtube_oembed(
    url: str,
    *,
    timeout_s: float = 5.0,
    opener: Any = None,
) -> dict[str, Any] | None:
    """Return `{title, thumbnail_url}` from YouTube's oEmbed endpoint.

    Returns None on any failure (DNS, 4xx/5xx, timeout, parse error).
    Honors a host allowlist so a bug can't accidentally fetch some
    third party's URL — even though the call site already checks
    `detect_source_type == "youtube"`, we re-validate here as
    defense-in-depth.
    """
    if detect_source_type(url) != "youtube":
        return None
    endpoint = "https://www.youtube.com/oembed?format=json&url=" + url.replace(" ", "%20")
    try:
        req = Request(endpoint, headers={"User-Agent": "JACOB/1.0"})
        do_open = opener or urlopen
        with do_open(req, timeout=timeout_s) as response:
            payload = response.read()
        data = json.loads(payload)
        if not isinstance(data, dict):
            return None
        return {
            "title": str(data.get("title") or "")[:200] or None,
            "thumbnail": str(data.get("thumbnail_url") or "") or None,
        }
    except Exception:  # noqa: BLE001
        # oEmbed is best-effort — the user supplied a URL and we'll
        # just store it without fancy metadata.
        logger.warning("youtube_oembed_failed url_host=%s", urlparse(url).hostname)
        return None
