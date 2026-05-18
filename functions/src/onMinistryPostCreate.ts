/**
 * ADR 0011 — central ministry feed fan-out.
 *
 * Fires when a `ministry_feed/{postId}` doc is created. Enumerates every
 * `notificationPrefs` doc with `ministryFeed == true` via a collection-
 * group query, then writes one `users/{uid}/notifications/{nid}` per
 * opted-in user. The existing `onNotificationCreate` trigger then
 * dispatches FCM the same way it does for every other notification kind.
 *
 * The opt-in is checked *here* (not at FCM-dispatch time) so opted-out
 * users do not see "Ministry feed posts" cluttering their inbox surface.
 * Defaults match `backend/app/models/users.py:NotificationPrefs`:
 * `ministryFeed: false`.
 *
 * Idempotency: top-level marker doc at `ministry_feed/{postId}/_events/{eventId}`.
 * The per-recipient notification doc id is deterministic
 * (`ministry_post_${postId}_${recipientUid}`) so a re-delivery before
 * the top-level marker lands still overwrites instead of duplicating.
 *
 * Cost / scale: one CG read + a batched fan-out write. Batch size 500
 * matches `backend/app/services/notifications.py:_BATCH_SIZE`.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { claimEventOnce } from "./services/eventMarkers";

if (!getApps().length) {
  initializeApp();
}

const BATCH_SIZE = 500;

type MinistryPostDoc = {
  title?: string;
  body?: string;
  authorUid?: string;
};

/** Exported for unit tests — extracts the recipient uid from a notificationPrefs
 *  doc reference (`users/{uid}/notificationPrefs/main`). */
export function recipientUidFromPrefsPath(path: string): string | null {
  const parts = path.split("/");
  if (parts.length >= 2 && parts[0] === "users") {
    return parts[1];
  }
  return null;
}

/** Exported for unit tests. */
export function buildNotifBody(title: string, body: string): string {
  const text = `${title.trim()}${title && body ? " — " : ""}${body.trim()}`;
  const collapsed = text.replace(/\s+/g, " ");
  return collapsed.length <= 200 ? collapsed : collapsed.slice(0, 199) + "…";
}

export async function fanOutMinistryPost(
  db: Firestore,
  args: {
    postId: string;
    authorUid: string;
    title: string;
    body: string;
  },
): Promise<number> {
  const { postId, authorUid, title, body } = args;

  // Pull every notificationPrefs doc with the opt-in set. The CG index
  // is configured in `firestore/firestore.indexes.json`.
  const prefsSnap = await db
    .collectionGroup("notificationPrefs")
    .where("ministryFeed", "==", true)
    .get();

  const recipients: string[] = [];
  for (const docSnap of prefsSnap.docs) {
    const recipientUid = recipientUidFromPrefsPath(docSnap.ref.path);
    if (!recipientUid) continue;
    if (recipientUid === authorUid) continue;
    recipients.push(recipientUid);
  }

  if (recipients.length === 0) return 0;

  const notifBody = buildNotifBody(title, body);
  let written = 0;

  // Pre-check blocks per recipient. The author here is the ministry
  // owner; if a recipient has explicitly blocked them, skip — matches
  // the boards/mention fan-out producer-side suppression at T21.
  const blockChecks = await Promise.all(
    recipients.map(async (uid) => {
      const snap = await db
        .collection("users")
        .doc(uid)
        .collection("blocks")
        .doc(authorUid)
        .get();
      return snap.exists ? null : uid;
    }),
  );
  const eligible = blockChecks.filter((u): u is string => u !== null);

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const chunk = eligible.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const uid of chunk) {
      const ref = db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .doc(`ministry_post_${postId}_${uid}`);
      batch.set(ref, {
        kind: "ministry_post",
        messageRef: `ministry_feed/${postId}`,
        fromUid: authorUid,
        body: notifBody,
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
        deliveredAt: null,
        failedAt: null,
      });
    }
    await batch.commit();
    written += chunk.length;
  }

  logger.info("ministry_post_fanout_done", {
    postId,
    candidates: prefsSnap.size,
    written,
  });
  return written;
}

export const onMinistryPostCreate = onDocumentCreated(
  {
    document: "ministry_feed/{postId}",
    region: "us-central1",
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const data = event.data?.data() as MinistryPostDoc | undefined;
    if (!data) return;

    const { postId } = event.params;
    const db = getFirestore();

    const postRef = db.collection("ministry_feed").doc(postId);
    const markerRef = postRef.collection("_events").doc(event.id);
    const fresh = await claimEventOnce(db, markerRef, {
      trigger: "onMinistryPostCreate",
    });
    if (!fresh) {
      logger.info("ministry post event already processed", {
        postId,
        eventId: event.id,
      });
      return;
    }

    const authorUid = data.authorUid ?? "";
    if (!authorUid) {
      logger.warn("ministry_post_missing_author_uid", { postId });
      return;
    }

    try {
      await fanOutMinistryPost(db, {
        postId,
        authorUid,
        title: data.title ?? "",
        body: data.body ?? "",
      });
    } catch (err) {
      logger.error("onMinistryPostCreate_fanout_failed", {
        postId,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
