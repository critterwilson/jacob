/**
 * ADR 0011 — denormalize reaction counts onto the parent ministry-feed post.
 * Mirrors `onBoardReactionWrite.ts`; shares `runReactionTxn` from
 * `onReactionWrite.ts`. Idempotent via `_reaction_events/{eventId}`.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { reactionDelta, runReactionTxn } from "./onReactionWrite";

if (!getApps().length) {
  initializeApp();
}

export const onMinistryReactionWrite = onDocumentWritten(
  {
    document: "ministry_feed/{postId}/reactions/{stickerSlug}/users/{uid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const delta = reactionDelta(Boolean(before?.exists), Boolean(after?.exists));
    if (delta === 0) return;

    const { postId, stickerSlug } = event.params;
    const db = getFirestore();
    const postRef = db.collection("ministry_feed").doc(postId);

    try {
      await db.runTransaction(async (txn) => {
        const applied = await runReactionTxn(
          txn,
          postRef,
          stickerSlug,
          delta,
          event.id,
        );
        if (!applied) {
          logger.info("ministry reaction event already processed", {
            eventId: event.id,
            postId,
          });
        }
      });
      logger.info("ministry reaction count adjusted", {
        postId,
        stickerSlug,
        delta,
        eventId: event.id,
      });
    } catch (err) {
      logger.error("onMinistryReactionWrite failed", {
        postId,
        stickerSlug,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
