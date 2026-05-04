/**
 * T22 + T54 — keep `groups/{gid}.leaderCount` in sync AND mirror
 * membership to `orgs/{orgId}/members/{uid}` when the parent group
 * is attached to an org.
 *
 * Fires on every write to `groups/{gid}/members/{uid}`. Pure helper
 * `leaderDelta` (exported for unit tests) computes the count delta
 * from the before/after role pair; the trigger applies it via a
 * transactional `FieldValue.increment(delta)` keyed by event id.
 *
 * Idempotency: the leader-count update writes a marker doc under
 * `groups/{gid}/_member_events/{eventId}`; the org-mirror update
 * writes a separate marker under
 * `orgs/{orgId}/_member_events/{gid}_{uid}_{eventId}` so the two
 * concerns can't deduplicate each other.
 *
 * Notes
 * - Member updates that don't change role are no-ops for leader-count,
 *   but join/leave still mutates org membership.
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

/**
 * T54 — mirror member presence onto `orgs/{orgId}/members/{uid}` when
 * the parent group has `orgId != null`. Pure helper extracted for unit
 * tests; the trigger calls it inside a separate transaction so a
 * failure here does not roll back the leader-count update.
 */
export type OrgMirrorAction = "noop" | "join" | "leave";

export function orgMirrorAction(
  beforeExists: boolean,
  afterExists: boolean,
): OrgMirrorAction {
  if (!beforeExists && afterExists) return "join";
  if (beforeExists && !afterExists) return "leave";
  return "noop";
}

async function applyOrgMirror(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  gid: string,
  uid: string,
  action: OrgMirrorAction,
  eventId: string,
): Promise<void> {
  if (action === "noop") return;
  const memberRef = db
    .collection("orgs")
    .doc(orgId)
    .collection("members")
    .doc(uid);
  const eventRef = db
    .collection("orgs")
    .doc(orgId)
    .collection("_member_events")
    .doc(`${gid}_${uid}_${eventId}`);

  await db.runTransaction(async (txn) => {
    const eventSnap = await txn.get(eventRef);
    if (eventSnap.exists) {
      logger.info("org_mirror event already processed", {
        eventId,
        orgId,
        gid,
        uid,
      });
      return;
    }
    const memberSnap = await txn.get(memberRef);
    const data = memberSnap.exists
      ? (memberSnap.data() as { groupIds?: string[] }) ?? {}
      : {};
    const existing = data.groupIds ?? [];

    if (action === "join") {
      if (existing.includes(gid)) {
        txn.set(eventRef, eventMarker({ action: "join", noop: true }));
        return;
      }
      const next = [...existing, gid];
      if (memberSnap.exists) {
        txn.update(memberRef, { groupIds: next });
      } else {
        txn.set(memberRef, {
          joinedAt: FieldValue.serverTimestamp(),
          groupIds: next,
        });
      }
    } else {
      if (!memberSnap.exists) {
        txn.set(eventRef, eventMarker({ action: "leave", noop: true }));
        return;
      }
      const next = existing.filter((g) => g !== gid);
      if (next.length === 0) {
        txn.delete(memberRef);
      } else {
        txn.update(memberRef, { groupIds: next });
      }
    }
    txn.set(eventRef, eventMarker({ action }));
  });
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

    const { gid, uid } = event.params;
    const db = getFirestore();
    const groupRef = db.collection("groups").doc(gid);

    // ── leader count ──
    const delta = leaderDelta(beforeExists, afterExists, beforeRole, afterRole);
    if (delta !== 0) {
      try {
        await db.runTransaction(async (txn) => {
          const eventRef = groupRef
            .collection("_member_events")
            .doc(event.id);
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
        logger.error("onMemberWrite leader-count failed", {
          gid,
          eventId: event.id,
          error: (err as Error).message,
        });
        throw err;
      }
    }

    // ── T54 org membership mirror ──
    const action = orgMirrorAction(beforeExists, afterExists);
    if (action === "noop") return;

    let groupSnap;
    try {
      groupSnap = await groupRef.get();
    } catch (err) {
      logger.error("onMemberWrite group-read failed", {
        gid,
        eventId: event.id,
        error: (err as Error).message,
      });
      return;
    }
    const orgId = (groupSnap.data() as { orgId?: string | null } | undefined)
      ?.orgId;
    if (!orgId) return;

    try {
      await applyOrgMirror(db, orgId, gid, uid, action, event.id);
      logger.info("org membership mirrored", {
        orgId,
        gid,
        uid,
        action,
        eventId: event.id,
      });
    } catch (err) {
      logger.error("onMemberWrite org-mirror failed", {
        orgId,
        gid,
        uid,
        eventId: event.id,
        error: (err as Error).message,
      });
      // Do not re-throw: leader-count already succeeded; let the
      // service-layer back-fill on the next attach call repair drift.
    }
  },
);
