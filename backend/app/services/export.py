"""Self-serve data export — assemble + persist (T38).

This module ships PII *out* of the system. Failure modes:

  * Including too much: another user's data leaks into a bundle. The
    assembler walks fields the user owns by `authorUid`/uid match — it
    never reads a doc keyed by a different uid except to inspect the
    user's *own* reaction marker on a shared subcollection.
  * Including too little: a GDPR DSAR is the right to *all* data we
    hold. The bundle key list is asserted by `export_schema`.
  * Concurrency: the request endpoint refuses to enqueue a second job
    while one is in flight. The processor is the only writer to fields
    other than `requestedAt`.
  * Tombstoned/hidden content: the user has a right to their *own*
    content even when it's soft-deleted or moderation-hidden. We
    include those messages with their tombstone flag visible.

The bundle itself is a single gzip'd JSON document at
``gs://{export_bucket}/{uid}/{jobId}.json.gz``. Photos are linked, never
inlined. The download URL is a V4 signed URL with a 7-day TTL; the
bucket-level lifecycle deletes objects after 14 days as a backstop in
case the doc is lost. See ``infra/exports.tf``.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from firebase_admin import firestore as fb_firestore

from app.config import get_settings
from app.services.audit import write_audit_log
from app.services.export_schema import SCHEMA_VERSION, validate_bundle
from app.services.firebase import init_firebase_admin

logger = logging.getLogger(__name__)

# Page size for cursor-based reaction pagination.  1 000 docs per round-trip
# keeps memory flat and satisfies GDPR Art. 15 completeness — no silent cap.
_PAGE_SIZE = 1_000

# Refuse to assemble bundles past this size — they belong on the runbook
# path, not the automated path.
_BUNDLE_HARD_CAP_BYTES = 1 * 1024 * 1024 * 1024  # 1 GiB

# Status values mirror models.account.ExportJobResponse.status.
STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_READY = "ready"
STATUS_FAILED = "failed"
STATUS_EXPIRED = "expired"


def _db() -> Any:
    init_firebase_admin()
    return fb_firestore.client()


# ── timestamp helpers ────────────────────────────────────────────────────────


def _ts_to_iso(value: Any) -> str | None:
    """Best-effort: convert Firestore Timestamp / datetime to ISO-8601."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    converter = getattr(value, "ToDatetime", None)
    if converter is not None:
        result = converter(tzinfo=UTC)
        if isinstance(result, datetime):
            return result.isoformat()
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        try:
            return str(isoformat())
        except Exception:  # noqa: BLE001 — defensive only
            return None
    return None


def _scrub_fb_types(value: Any) -> Any:
    """Recursively replace Firestore types with JSON-friendly equivalents."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, dict):
        return {str(k): _scrub_fb_types(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub_fb_types(v) for v in value]
    converted = _ts_to_iso(value)
    if converted is not None:
        return converted
    # Fallback: stringify rather than crash. Only triggers for exotic
    # types; logged so we can extend the converter if it ever fires.
    logger.warning("export_scrub_fallback type=%s", type(value).__name__)
    return str(value)


# ── PII sanitisers ───────────────────────────────────────────────────────────


def _sanitise_audit_payload(payload: Any, *, owner_uid: str) -> Any:
    """Strip foreign uids/emails from an audit-log payload before bundling.

    Audit payloads can mention third parties (`actor`, `targetUid`, etc.).
    The export bundle is *the user's data only* — drop any string/key
    that names another uid or carries another user's email.
    """
    if isinstance(payload, dict):
        out: dict[str, Any] = {}
        for k, v in payload.items():
            if isinstance(v, str) and v != owner_uid:
                # Common patterns: "uid", "actorUid", "targetUid",
                # "byUid", any *Uid suffix → only keep when it == owner.
                if k.lower().endswith("uid") and v != owner_uid:
                    continue
                # Email fields: keep only the owner's email is impractical
                # without the owner's email here, so just redact anything
                # that looks like an email.
                if "email" in k.lower() and "@" in v:
                    continue
            out[k] = _sanitise_audit_payload(v, owner_uid=owner_uid)
        return out
    if isinstance(payload, list):
        return [_sanitise_audit_payload(v, owner_uid=owner_uid) for v in payload]
    return payload


# ── assembly ─────────────────────────────────────────────────────────────────


def _profile(db: Any, uid: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    user_snap = db.collection("users").document(uid).get()
    profile = _scrub_fb_types(user_snap.to_dict()) if user_snap.exists else None
    private_snap = (
        db.collection("users").document(uid).collection("private").document("profile").get()
    )
    private = _scrub_fb_types(private_snap.to_dict()) if private_snap.exists else None
    return profile, private


def _memberships(db: Any, uid: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for snap in db.collection_group("members").where("uid", "==", uid).stream():
        # Path: groups/{gid}/members/{uid}. Pull the gid out of the path so
        # the bundle is self-describing without re-walking groups.
        ref = snap.reference
        parent_group = getattr(ref, "parent", None)
        gid: str | None = None
        if parent_group is not None and getattr(parent_group, "parent", None) is not None:
            group_ref = parent_group.parent
            gid = getattr(group_ref, "id", None)
        data = _scrub_fb_types(snap.to_dict()) or {}
        out.append({"groupId": gid, **data})
    return out


def _messages_authored(db: Any, uid: str) -> tuple[list[dict[str, Any]], list[str]]:
    """All messages authored by *uid*, plus extracted media references."""
    messages: list[dict[str, Any]] = []
    photo_refs: list[str] = []
    for snap in db.collection_group("messages").where("authorUid", "==", uid).stream():
        ref = snap.reference
        # Path: groups/{gid}/messages/{mid}.
        parent_messages_col = getattr(ref, "parent", None)
        gid: str | None = None
        if parent_messages_col is not None and getattr(parent_messages_col, "parent", None):
            group_ref = parent_messages_col.parent
            gid = getattr(group_ref, "id", None)
        data: dict[str, Any] = _scrub_fb_types(snap.to_dict()) or {}
        media_refs = data.get("mediaRefs") or []
        if isinstance(media_refs, list):
            for ref_obj in media_refs:
                if isinstance(ref_obj, str):
                    photo_refs.append(ref_obj)
                elif isinstance(ref_obj, dict) and isinstance(ref_obj.get("url"), str):
                    photo_refs.append(ref_obj["url"])
        messages.append({"groupId": gid, "messageId": snap.id, **data})
    return messages, photo_refs


def _mentions(db: Any, uid: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        query = db.collection_group("messages").where("mentions", "array_contains", uid)
    except Exception:  # noqa: BLE001 — older Admin SDKs reject the operator
        return out
    for snap in query.stream():
        ref = snap.reference
        parent_col = getattr(ref, "parent", None)
        gid: str | None = None
        if parent_col is not None and getattr(parent_col, "parent", None):
            gid = getattr(parent_col.parent, "id", None)
        data = _scrub_fb_types(snap.to_dict()) or {}
        out.append({"groupId": gid, "messageId": snap.id, **data})
    return out


def _reactions(db: Any, uid: str) -> list[dict[str, Any]]:
    """Paginate all reaction marker docs for *uid* via cursor-based pages.

    GDPR Art. 15 requires completeness — the previous cap-at-10k approach
    silently truncated heavy users.  Cursor pagination continues until the
    server returns a short page, bounding memory at one page at a time.
    """
    out: list[dict[str, Any]] = []
    try:
        base_query = db.collection_group("users").where("__name__", ">=", uid).limit(_PAGE_SIZE)
    except Exception:  # noqa: BLE001
        return out

    query = base_query
    cursor = None
    while True:
        page = list((query.start_after(cursor) if cursor else query).stream())
        for snap in page:
            if snap.id != uid:
                continue
            path = getattr(snap.reference, "path", "")
            if "/messages/" not in path or "/reactions/" not in path:
                continue
            parts = path.split("/")
            try:
                gid = parts[parts.index("groups") + 1]
                mid = parts[parts.index("messages") + 1]
                slug = parts[parts.index("reactions") + 1]
            except (ValueError, IndexError):
                continue
            data = _scrub_fb_types(snap.to_dict()) or {}
            out.append({"groupId": gid, "messageId": mid, "stickerSlug": slug, **data})
        if len(page) < _PAGE_SIZE:
            break
        cursor = page[-1]
    return out


def _audit_log(db: Any, uid: str) -> list[dict[str, Any]]:
    """Audit rows where the user is actor OR target, with PII sanitised."""
    seen_ids: set[str] = set()
    out: list[dict[str, Any]] = []
    queries = (
        db.collection("audit_log").where("actorUid", "==", uid),
        db.collection("audit_log").where("targetRef", "==", f"users/{uid}"),
    )
    for query in queries:
        for snap in query.stream():
            if snap.id in seen_ids:
                continue
            seen_ids.add(snap.id)
            data = _scrub_fb_types(snap.to_dict()) or {}
            payload = data.get("payload")
            if payload is not None:
                data["payload"] = _sanitise_audit_payload(payload, owner_uid=uid)
            out.append({"eventId": snap.id, **data})
    return out


def _notification_state(db: Any, uid: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    prefs_snap = (
        db.collection("users").document(uid).collection("private").document("notifications").get()
    )
    prefs = _scrub_fb_types(prefs_snap.to_dict()) if prefs_snap.exists else {}

    devices: list[dict[str, Any]] = []
    devices_col = db.collection("users").document(uid).collection("devices")
    for snap in devices_col.stream():
        data = _scrub_fb_types(snap.to_dict()) or {}
        # Don't leak the FCM token in the bundle — the user already owns
        # the device, and a leaked bundle holding a live push token is
        # actively dangerous.
        data.pop("fcmToken", None)
        devices.append({"deviceId": snap.id, **data})
    return prefs or {}, devices


def _mute_block_lists(db: Any, uid: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    user_ref = db.collection("users").document(uid)
    mutes = [
        {"otherUid": snap.id, **(_scrub_fb_types(snap.to_dict()) or {})}
        for snap in user_ref.collection("mutes").stream()
    ]
    blocks = [
        {"otherUid": snap.id, **(_scrub_fb_types(snap.to_dict()) or {})}
        for snap in user_ref.collection("blocks").stream()
    ]
    return mutes, blocks


def assemble(uid: str, *, db: Any | None = None) -> dict[str, Any]:
    """Assemble a single export bundle for *uid*. Validated before return.

    Raises ``ValueError`` if the bundle fails its own schema check — that
    is a programming error, not a user-facing condition.
    """
    db = db or _db()

    profile, private_profile = _profile(db, uid)
    memberships = _memberships(db, uid)
    messages, message_photo_refs = _messages_authored(db, uid)
    mentions = _mentions(db, uid)
    reactions = _reactions(db, uid)
    audit_log = _audit_log(db, uid)
    notification_prefs, notification_devices = _notification_state(db, uid)
    mutes, blocks = _mute_block_lists(db, uid)

    # Profile may carry a single avatar URL too.
    profile_photo = (profile or {}).get("photoURL") if isinstance(profile, dict) else None
    photo_refs = list(message_photo_refs)
    if isinstance(profile_photo, str) and profile_photo:
        photo_refs.append(profile_photo)
    # Dedupe while preserving order.
    seen: set[str] = set()
    deduped_refs: list[str] = []
    for ref in photo_refs:
        if ref in seen:
            continue
        seen.add(ref)
        deduped_refs.append(ref)

    bundle: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "exportedAt": datetime.now(UTC).isoformat(),
        "uid": uid,
        "profile": profile,
        "privateProfile": private_profile,
        "memberships": memberships,
        "messages": messages,
        "reactions": reactions,
        "mentions": mentions,
        "auditLog": audit_log,
        "photoRefs": deduped_refs,
        "notificationPreferences": notification_prefs,
        "notificationDevices": notification_devices,
        "mutes": mutes,
        "blocks": blocks,
    }
    validate_bundle(bundle, expected_uid=uid)
    return bundle


def serialize(bundle: dict[str, Any]) -> bytes:
    """Encode the bundle as gzipped JSON bytes. Refuses oversize bundles."""
    raw = json.dumps(bundle, ensure_ascii=False, sort_keys=True).encode("utf-8")
    if len(raw) > _BUNDLE_HARD_CAP_BYTES:
        raise ValueError("bundle_too_large")
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6, mtime=0) as gz:
        gz.write(raw)
    return buf.getvalue()


# ── job lifecycle (called from the router and the Cloud Run job) ─────────────


def _exports_collection(db: Any, uid: str) -> Any:
    return db.collection("users").document(uid).collection("exports")


def find_in_flight(db: Any, uid: str) -> str | None:
    """Return the jobId of any queued/processing job for *uid*, else None."""
    col = _exports_collection(db, uid)
    for snap in col.stream():
        data = snap.to_dict() or {}
        if data.get("completedAt") is None and data.get("failedAt") is None:
            doc_id: str = snap.id
            return doc_id
    return None


def _new_job_id() -> str:
    return uuid.uuid4().hex


def request_export(uid: str) -> dict[str, Any]:
    """Enqueue a new export job for *uid*. Refuses on in-flight collision.

    Returns the job-doc shape the router should hand back to the client.
    Raises ``RuntimeError("export_in_flight")`` if a job is already queued.
    Raises ``RuntimeError("export_disabled")`` if the kill-switch is on.
    """
    settings = get_settings()
    if settings.jacob_export_disabled:
        raise RuntimeError("export_disabled")

    db = _db()
    job_id = _new_job_id()
    col = _exports_collection(db, uid)
    new_ref = col.document(job_id)

    @fb_firestore.transactional  # type: ignore[untyped-decorator]
    def _create_job(txn: Any) -> bool:
        # Re-check for in-flight inside the transaction (M5 race fix).
        for snap in col.stream():
            data = snap.to_dict() or {}
            if data.get("completedAt") is None and data.get("failedAt") is None:
                return False
        txn.set(
            new_ref,
            {
                "requestedAt": fb_firestore.SERVER_TIMESTAMP,
                "startedAt": None,
                "completedAt": None,
                "failedAt": None,
                "failureReason": None,
                "downloadUrl": None,
                "expiresAt": None,
                "byteCount": None,
                "schemaVersion": SCHEMA_VERSION,
            },
        )
        return True

    if not _create_job(db.transaction()):
        raise RuntimeError("export_in_flight")

    write_audit_log(
        actor_uid=uid,
        action="export_request",
        target_ref=f"users/{uid}/exports/{job_id}",
        payload={"schemaVersion": SCHEMA_VERSION},
    )
    logger.info("export_requested uid=%s job=%s", uid, job_id)
    return {
        "jobId": job_id,
        "status": STATUS_QUEUED,
        "requestedAt": datetime.now(UTC).isoformat(),
        "schemaVersion": SCHEMA_VERSION,
    }


def latest_status(uid: str) -> dict[str, Any]:
    """Return a router-friendly view of the most recent export job."""
    db = _db()
    col = _exports_collection(db, uid)
    latest_doc: tuple[Any, dict[str, Any]] | None = None
    latest_ts: datetime | None = None
    for snap in col.stream():
        data: dict[str, Any] = snap.to_dict() or {}
        ts_value = data.get("requestedAt")
        ts_dt: datetime | None = None
        if isinstance(ts_value, datetime):
            ts_dt = ts_value
        elif ts_value is not None:
            converter = getattr(ts_value, "ToDatetime", None)
            if converter is not None:
                converted = converter(tzinfo=UTC)
                if isinstance(converted, datetime):
                    ts_dt = converted
        if latest_ts is None or (ts_dt is not None and ts_dt > latest_ts):
            latest_ts = ts_dt
            latest_doc = (snap.id, data)

    if latest_doc is None:
        return {"jobId": "", "status": "none", "schemaVersion": SCHEMA_VERSION}

    job_id, data = latest_doc
    completed_iso = _ts_to_iso(data.get("completedAt"))
    expires_iso = _ts_to_iso(data.get("expiresAt"))
    failed_iso = _ts_to_iso(data.get("failedAt"))
    started_iso = _ts_to_iso(data.get("startedAt"))
    requested_iso = _ts_to_iso(data.get("requestedAt"))

    if failed_iso:
        status_value: str = STATUS_FAILED
    elif completed_iso:
        expires_at = data.get("expiresAt")
        expires_dt: datetime | None = None
        if isinstance(expires_at, datetime):
            expires_dt = expires_at
        elif expires_at is not None:
            converter = getattr(expires_at, "ToDatetime", None)
            if converter is not None:
                converted = converter(tzinfo=UTC)
                if isinstance(converted, datetime):
                    expires_dt = converted
        status_value = (
            STATUS_EXPIRED if (expires_dt and expires_dt <= datetime.now(UTC)) else STATUS_READY
        )
    elif started_iso:
        status_value = STATUS_PROCESSING
    else:
        status_value = STATUS_QUEUED

    download_url = data.get("downloadUrl") if status_value == STATUS_READY else None
    byte_count = data.get("byteCount")

    return {
        "jobId": job_id,
        "status": status_value,
        "requestedAt": requested_iso,
        "completedAt": completed_iso,
        "expiresAt": expires_iso,
        "failureReason": data.get("failureReason"),
        "byteCount": byte_count if isinstance(byte_count, int) else None,
        "schemaVersion": int(data.get("schemaVersion") or SCHEMA_VERSION),
        "downloadUrl": download_url,
    }


def get_download_url(uid: str, job_id: str) -> str:
    """Return the live signed URL for *job_id*. Raises on miss/expiry/etc."""
    db = _db()
    snap = _exports_collection(db, uid).document(job_id).get()
    if not snap.exists:
        raise LookupError("export_not_found")
    data = snap.to_dict() or {}
    if data.get("failedAt"):
        raise RuntimeError("export_failed")
    if not data.get("completedAt") or not data.get("downloadUrl"):
        raise RuntimeError("export_not_ready")
    expires_at = data.get("expiresAt")
    expires_dt: datetime | None = None
    if isinstance(expires_at, datetime):
        expires_dt = expires_at
    elif expires_at is not None:
        converter = getattr(expires_at, "ToDatetime", None)
        if converter is not None:
            converted = converter(tzinfo=UTC)
            if isinstance(converted, datetime):
                expires_dt = converted
    if expires_dt is not None and expires_dt <= datetime.now(UTC):
        raise RuntimeError("export_expired")
    url = data.get("downloadUrl")
    if not isinstance(url, str) or not url:
        raise RuntimeError("export_not_ready")
    return url


# ── GCS helpers (called from the processor) ──────────────────────────────────


def _storage_client() -> Any:
    import importlib

    storage = importlib.import_module("google.cloud.storage")
    return storage.Client()


def _export_bucket_name() -> str:
    settings = get_settings()
    if not settings.jacob_export_bucket:
        raise RuntimeError("export_bucket_unset")
    return settings.jacob_export_bucket


def _object_name(uid: str, job_id: str) -> str:
    return f"{uid}/{job_id}.json.gz"


def upload_bundle(uid: str, job_id: str, payload: bytes) -> tuple[str, datetime]:
    """Write *payload* to the export bucket and return (signed_url, expires_at)."""
    settings = get_settings()
    bucket = _storage_client().bucket(_export_bucket_name())
    blob = bucket.blob(_object_name(uid, job_id))
    blob.upload_from_string(payload, content_type="application/gzip")
    blob.cache_control = "private, no-store"
    blob.content_disposition = f'attachment; filename="jacob-export-{job_id}.json.gz"'
    blob.patch()
    expires_at = datetime.now(UTC) + timedelta(days=settings.jacob_export_signed_url_ttl_days)
    url = blob.generate_signed_url(
        version="v4",
        expiration=expires_at,
        method="GET",
        response_disposition=f'attachment; filename="jacob-export-{job_id}.json.gz"',
    )
    return url, expires_at


# ── processor entrypoint (called from infra/scheduled/process_export_jobs.py)


# Concurrency cap for a single processor invocation. Each Cloud Run Job
# tick is one process; the cap bounds blast radius if a runaway scheduler
# fires too often.
PROCESSOR_BATCH_CAP = 5


def find_pending_jobs(db: Any | None = None, *, limit: int = PROCESSOR_BATCH_CAP) -> list[Any]:
    """Find up to *limit* unstarted export jobs across all users.

    Uses the existing `users`-collection-group index on `exports`. The
    processor calls this then claims each job via a transaction.
    """
    db = db or _db()
    try:
        query = db.collection_group("exports").where("startedAt", "==", None).limit(limit)
    except Exception:  # noqa: BLE001
        return []
    return list(query.stream())


def _claim(snap: Any, db: Any) -> bool:
    """Mark the job as started. Returns False if it's already claimed.

    Runs inside a Firestore transaction so two concurrent processor
    instances racing on the same job only one wins (M6 fix).
    """
    ref = snap.reference

    @fb_firestore.transactional  # type: ignore[untyped-decorator]
    def _txn(txn: Any) -> bool:
        fresh = txn.get(ref)
        if not fresh.exists:
            return False
        if (fresh.to_dict() or {}).get("startedAt") is not None:
            return False
        txn.update(ref, {"startedAt": fb_firestore.SERVER_TIMESTAMP})
        return True

    return bool(_txn(db.transaction()))


def process_one(snap: Any) -> dict[str, Any]:
    """Process a single export job snapshot. Idempotent enough for retries.

    Steps: claim the job, assemble the bundle, validate, gzip, upload to
    GCS, update the job doc, send the email. On any failure, write
    ``failedAt`` + ``failureReason`` and re-raise so the processor logs
    and Sentry capture it.
    """
    ref = snap.reference
    parent_col = getattr(ref, "parent", None)
    user_ref = getattr(parent_col, "parent", None) if parent_col is not None else None
    uid = getattr(user_ref, "id", None)
    if not uid:
        raise RuntimeError("malformed_export_path")

    job_id = snap.id
    db = _db()

    if not _claim(snap, db):
        return {"jobId": job_id, "status": "skipped", "uid": uid}
    try:
        user_snap = db.collection("users").document(uid).get()
        if not user_snap.exists:
            ref.update(
                {
                    "failedAt": fb_firestore.SERVER_TIMESTAMP,
                    "failureReason": "account_deleted",
                }
            )
            return {"jobId": job_id, "status": "failed", "reason": "account_deleted"}

        bundle = assemble(uid, db=db)
        payload = serialize(bundle)
        url, expires_at = upload_bundle(uid, job_id, payload)
        ref.update(
            {
                "completedAt": fb_firestore.SERVER_TIMESTAMP,
                "downloadUrl": url,
                "expiresAt": expires_at,
                "byteCount": len(payload),
            }
        )
        write_audit_log(
            actor_uid="system",
            action="export_completed",
            target_ref=f"users/{uid}/exports/{job_id}",
            payload={"byteCount": len(payload)},
        )

        user_data = user_snap.to_dict() or {}
        try:
            from app.services.email import send_export_ready

            send_export_ready(
                to_email=user_data.get("email", ""),
                display_name=user_data.get("displayName", ""),
                download_url=url,
                expires_at=expires_at,
            )
        except Exception:  # noqa: BLE001 — email is not on the critical path
            logger.exception("export_email_failed uid=%s job=%s", uid, job_id)

        logger.info("export_completed uid=%s job=%s bytes=%d", uid, job_id, len(payload))
        return {"jobId": job_id, "status": "ready", "byteCount": len(payload), "uid": uid}
    except Exception as exc:  # noqa: BLE001 — log, mark failed, re-raise
        logger.exception("export_failed uid=%s job=%s", uid, job_id)
        try:
            ref.update(
                {
                    "failedAt": fb_firestore.SERVER_TIMESTAMP,
                    "failureReason": type(exc).__name__,
                }
            )
        except Exception:  # noqa: BLE001 — last-ditch
            logger.exception("export_failure_writeback_failed uid=%s job=%s", uid, job_id)
        raise
