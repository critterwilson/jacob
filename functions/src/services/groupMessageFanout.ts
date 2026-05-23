/**
 * group_message fan-out — push notifications for ordinary top-level
 * group messages (not @mentions, not thread replies, not announcements).
 *
 * Writes one `users/{uid}/notifications/{nid}` doc per eligible recipient.
 * `onNotificationCreate` then picks each one up and enqueues an FCM task.
 *
 * Exclusion order (matches the spirit of `mentionFanout` and
 * `onMinistryPostCreate`):
 *   1. author (no self-push)
 *   2. recipient already covered by a same-message mention notification
 *      (avoids "you were mentioned" + "new message" duplicate for the
 *      same write)
 *   3. recipient who blocked the author
 *   4. recipient who muted this group
 *      (`users/{uid}/mutedGroups/{gid}` doc exists)
 *
 * Idempotency: callers pass the trigger's `event.id`. Notification doc
 * ids are deterministic — `group_message_${eventId}_${recipientUid}` —
 * so a redelivered trigger overwrites the same doc per recipient instead
 * of producing N duplicates.
 *
 * Writes are batched (500-op Firestore limit, 400-op safety chunk).
 */

import {
  FieldValue,
  type Firestore,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

const BATCH_SIZE = 400;

export type GroupMessageFanoutArgs = {
  gid: string;
  mid: string;
  authorUid: string;
  /** Body excerpt for the FCM payload. Caller truncates as needed. */
  body: string;
  /** Uids already getting a `mention` notification for this same write. */
  alreadyNotifiedUids: string[];
  eventId: string;
};

/**
 * Returns the number of `group_message` notification docs written.
 * Throws on Firestore errors so the caller can log + let the trigger
 * retry (or, in our case, swallow — fan-out failures shouldn't kill the
 * whole onMessageCreate trigger).
 */
export async function fanOutGroupMessage(
  db: Firestore,
  args: GroupMessageFanoutArgs,
): Promise<number> {
  const { gid, mid, authorUid, body, alreadyNotifiedUids, eventId } = args;

  const membersSnap = await db
    .collection("groups")
    .doc(gid)
    .collection("members")
    .get();
  if (membersSnap.empty) return 0;

  const alreadyNotified = new Set(alreadyNotifiedUids);
  const candidates = membersSnap.docs
    .map((d) => d.id)
    .filter((uid) => uid !== authorUid && !alreadyNotified.has(uid));
  if (candidates.length === 0) return 0;

  const eligibility = await Promise.all(
    candidates.map(async (uid) => {
      const [blockSnap, muteSnap] = await Promise.all([
        db
          .collection("users")
          .doc(uid)
          .collection("blocks")
          .doc(authorUid)
          .get(),
        db
          .collection("users")
          .doc(uid)
          .collection("mutedGroups")
          .doc(gid)
          .get(),
      ]);
      if (blockSnap.exists) return null;
      if (muteSnap.exists) return null;
      return uid;
    }),
  );
  const eligible = eligibility.filter((u): u is string => u !== null);
  if (eligible.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const chunk = eligible.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const uid of chunk) {
      const ref = db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .doc(`group_message_${eventId}_${uid}`);
      batch.set(ref, {
        kind: "group_message",
        groupId: gid,
        messageRef: `groups/${gid}/messages/${mid}`,
        fromUid: authorUid,
        body,
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });
    }
    await batch.commit();
    written += chunk.length;
  }

  logger.info("group_message_fanout_done", {
    gid,
    mid,
    eventId,
    members: membersSnap.size,
    eligible: eligible.length,
    written,
  });
  return written;
}
