"""JSON Schema for the T38 data-export bundle.

The bundle is the contract we hand the user. Future schema changes bump
`SCHEMA_VERSION` and document the migration path in `docs/gdpr.md`.

We hand-roll a small validator here rather than pull in `jsonschema` —
this is a closed schema we control on both sides, and the validator only
needs to:

  1. Reject extra top-level keys (catches typos before bytes hit GCS).
  2. Pin every required key.
  3. Pin a few invariants: schema version, `uid` on the bundle envelope,
     each list element shape.

If the schema grows enough that this hand-roll becomes burdensome, swap
to `jsonschema` and dial up the constraints there.
"""

from __future__ import annotations

from typing import Any

SCHEMA_VERSION = 1

# Names of the bundle's top-level keys. Must match exactly what
# `export.assemble` returns and what `export_ready.html.j2` references.
TOP_LEVEL_KEYS = frozenset(
    {
        "schemaVersion",
        "exportedAt",
        "uid",
        "profile",
        "privateProfile",
        "memberships",
        "messages",
        "reactions",
        "mentions",
        "auditLog",
        "photoRefs",
        "notificationPreferences",
        "notificationDevices",
        "mutes",
        "blocks",
    }
)


def validate_bundle(bundle: dict[str, Any], *, expected_uid: str) -> None:
    """Validate *bundle* in-place. Raises ``ValueError`` on any deviation.

    Caller catches the ValueError and writes ``failureReason="invalid_bundle"``
    to the export job doc — bundles never reach GCS half-broken.
    """
    if not isinstance(bundle, dict):
        raise ValueError("bundle must be a dict")

    actual_keys = set(bundle.keys())
    extra = actual_keys - TOP_LEVEL_KEYS
    if extra:
        raise ValueError(f"bundle contains unexpected top-level keys: {sorted(extra)}")
    missing = TOP_LEVEL_KEYS - actual_keys
    if missing:
        raise ValueError(f"bundle missing required top-level keys: {sorted(missing)}")

    if bundle["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError(f"schemaVersion must be {SCHEMA_VERSION}, got {bundle['schemaVersion']!r}")

    if not isinstance(bundle["uid"], str) or bundle["uid"] != expected_uid:
        raise ValueError("uid mismatch on bundle envelope")

    if not isinstance(bundle["exportedAt"], str) or not bundle["exportedAt"]:
        raise ValueError("exportedAt must be a non-empty ISO-8601 string")

    # Profile + private profile may be None if the user docs were absent
    # mid-flight (rare but possible during deletion races).
    for key in ("profile", "privateProfile"):
        value = bundle[key]
        if value is not None and not isinstance(value, dict):
            raise ValueError(f"{key} must be a dict or null")

    list_keys = (
        "memberships",
        "messages",
        "reactions",
        "mentions",
        "auditLog",
        "photoRefs",
        "notificationDevices",
        "mutes",
        "blocks",
    )
    for key in list_keys:
        value = bundle[key]
        if not isinstance(value, list):
            raise ValueError(f"{key} must be a list")

    if not isinstance(bundle["notificationPreferences"], dict):
        raise ValueError("notificationPreferences must be a dict (may be empty)")
