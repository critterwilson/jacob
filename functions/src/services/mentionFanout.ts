/**
 * T27 / T32 — generic mention fan-out helper.
 *
 * Writes one `users/{uid}/notifications/{nid}` row per recipient that
 *   1. is not the author themself,
 *   2. has not blocked the author (per `users/{uid}/blocks/{authorUid}`),
 *   3. passes the host-specific membership check (via `isMember`).
 *
 * Boards (T32) have no membership concept — pass `async () => true`.
 * Group chat (T27) checks `groups/{gid}/members/{uid}`.
 *
 * Idempotency: callers pass the trigger's `event.id`. Notification doc
 * ids are deterministic — `mention_${eventId}_${recipientUid}` — so a
 * redelivered trigger overwrites the same doc instead of creating a new
 * one per recipient. Mirrors the reply-notification pattern in
 * `onMessageWrite.ts`.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type MentionNotificationPayload = {
  kind: "mention" | "board_mention";
  messageRef: string;
  groupId?: string;
  boardId?: string;
  body?: string;
};

export async function fanOutMentions(
  db: Firestore,
  args: {
    authorUid: string;
    mentions: string[];
    payload: MentionNotificationPayload;
    isMember: (uid: string) => Promise<boolean>;
    eventId: string;
  },
): Promise<void> {
  const { authorUid, mentions, payload, isMember, eventId } = args;
  await Promise.all(
    mentions.map(async (recipientUid) => {
      if (recipientUid === authorUid) return;

      const blockSnap = await db
        .collection("users")
        .doc(recipientUid)
        .collection("blocks")
        .doc(authorUid)
        .get();
      if (blockSnap.exists) return;

      if (!(await isMember(recipientUid))) return;

      await db
        .collection("users")
        .doc(recipientUid)
        .collection("notifications")
        .doc(`mention_${eventId}_${recipientUid}`)
        .set({
          ...payload,
          fromUid: authorUid,
          createdAt: FieldValue.serverTimestamp(),
          readAt: null,
        });
    }),
  );
}
