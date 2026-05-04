/**
 * Idempotency-marker payload for Firestore-trigger event dedupe.
 *
 * Cloud Function delivery is at-least-once, so each trigger writes a
 * marker doc keyed on `event.id` to skip duplicate deliveries. The
 * markers have no value beyond the dedupe window — see M16 in
 * `docs/follow-ups/phase-2-deferred.md`.
 *
 * `expiresAt` powers Firestore per-doc TTL (configured via
 * `infra/firestore-ttls.sh`). 7 days is comfortably longer than any
 * plausible re-delivery window for v2 Firestore triggers (which retry
 * on a bounded backoff measured in minutes-to-hours, never days).
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export const EVENT_MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function eventMarker(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    processedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + EVENT_MARKER_TTL_MS),
    ...extra,
  };
}
