/**
 * T26 — denormalize reaction counts onto the parent message.
 *
 * Trigger: groups/{gid}/messages/{mid}/reactions/{stickerSlug}/users/{uid}
 *
 * Logic:
 *   - delta = +1 (create) | -1 (delete) | 0 (update, no-op)
 *   - idempotent on event.id via messages/{mid}/_reaction_events/{eventId}
 *   - sets messages/{mid}.reactionCounts.{stickerSlug} via FieldValue.increment
 *   - counts are never deleted; 0 is filtered client-side
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore, type Transaction, type DocumentReference } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

if (!getApps().length) {
  initializeApp();
}

export function reactionDelta(beforeExists: boolean, afterExists: boolean): number {
  if (!beforeExists && afterExists) return 1;
  if (beforeExists && !afterExists) return -1;
  return 0;
}

export async function runReactionTxn(
  txn: Transaction,
  messageRef: DocumentReference,
  stickerSlug: string,
  delta: number,
  eventId: string,
): Promise<boolean> {
  const eventRef = messageRef.collection("_reaction_events").doc(eventId);
  const eventSnap = await txn.get(eventRef);
  if (eventSnap.exists) {
    return false;
  }
  txn.set(eventRef, { processedAt: FieldValue.serverTimestamp(), delta });
  txn.set(
    messageRef,
    { reactionCounts: { [stickerSlug]: FieldValue.increment(delta) } },
    { merge: true },
  );
  return true;
}

export const onReactionWrite = onDocumentWritten(
  {
    document:
      "groups/{gid}/messages/{mid}/reactions/{stickerSlug}/users/{uid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const delta = reactionDelta(Boolean(before?.exists), Boolean(after?.exists));
    if (delta === 0) return;

    const { gid, mid, stickerSlug } = event.params;
    const db = getFirestore();
    const messageRef = db
      .collection("groups")
      .doc(gid)
      .collection("messages")
      .doc(mid);

    try {
      await db.runTransaction(async (txn) => {
        const applied = await runReactionTxn(txn, messageRef, stickerSlug, delta, event.id);
        if (!applied) {
          logger.info("reaction event already processed", {
            eventId: event.id,
            gid,
            mid,
          });
        }
      });
      logger.info("reaction count adjusted", {
        gid,
        mid,
        stickerSlug,
        delta,
        eventId: event.id,
      });
    } catch (err) {
      logger.error("onReactionWrite failed", {
        gid,
        mid,
        stickerSlug,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
