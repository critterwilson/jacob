/**
 * T22 — keep `groups/{gid}.leaderCount` in sync.
 *
 * Fires on every write to `groups/{gid}/members/{uid}`. Pure helper
 * `leaderDelta` (exported for unit tests) computes the count delta
 * from the before/after role pair; the trigger applies it via a
 * transactional `FieldValue.increment(delta)` keyed by event id.
 *
 * Idempotency: we record the event id under
 * `groups/{gid}/members/{uid}/_events/{eventId}` (mirrors
 * onMessageWrite). At-least-once delivery from Firestore is normal;
 * the dedup doc prevents double-increment.
 *
 * Notes
 * - Member updates that don't change role are no-ops (delta == 0).
 * - The leaderless-guard rule (firestore.rules) reads `leaderCount`,
 *   so this trigger MUST stay correct or self-leave will start letting
 *   groups drop to zero leaders.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import { eventMarker } from "./services/eventMarkers";

if (!getApps().length) {
  initializeApp();
}

export type MemberRole = "member" | "leader";

/**
 * Compute the leader-count delta. Pure function — easily tested.
 *
 *   beforeExists/afterExists: whether the doc exists in each snapshot.
 *   beforeRole/afterRole: role string from the snapshot data.
 */
export function leaderDelta(
  beforeExists: boolean,
  afterExists: boolean,
  beforeRole: string | undefined,
  afterRole: string | undefined,
): number {
  const wasLeader = beforeExists && beforeRole === "leader";
  const isLeader = afterExists && afterRole === "leader";
  if (wasLeader === isLeader) return 0;
  return isLeader ? 1 : -1;
}

export const onMemberWrite = onDocumentWritten(
  {
    document: "groups/{gid}/members/{uid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeExists = Boolean(before?.exists);
    const afterExists = Boolean(after?.exists);
    const beforeRole = (before?.data() as { role?: string } | undefined)?.role;
    const afterRole = (after?.data() as { role?: string } | undefined)?.role;

    const delta = leaderDelta(beforeExists, afterExists, beforeRole, afterRole);
    if (delta === 0) return;

    const { gid } = event.params;
    const db = getFirestore();
    const groupRef = db.collection("groups").doc(gid);

    try {
      await db.runTransaction(async (txn) => {
        // Idempotency guard mirrors onMessageWrite — Firestore delivery
        // is at-least-once.
        const eventRef = groupRef.collection("_member_events").doc(event.id);
        const eventSnap = await txn.get(eventRef);
        if (eventSnap.exists) {
          logger.info("member event already processed", {
            eventId: event.id,
            gid,
          });
          return;
        }
        txn.set(eventRef, eventMarker({ delta }));
        txn.set(
          groupRef,
          { leaderCount: FieldValue.increment(delta) },
          { merge: true },
        );
      });
      logger.info("leader count adjusted", {
        gid,
        delta,
        eventId: event.id,
      });
    } catch (err) {
      logger.error("onMemberWrite failed", {
        gid,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
