/**
 * T32 — denormalize reaction counts onto the parent board post.
 * Mirrors `onReactionWrite.ts` but keyed on the boards path. Idempotent
 * via `_reaction_events/{eventId}` under the parent post.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { reactionDelta, runReactionTxn } from "./onReactionWrite";

if (!getApps().length) {
  initializeApp();
}

export const onBoardReactionWrite = onDocumentWritten(
  {
    document:
      "boards/{boardId}/posts/{postId}/reactions/{stickerSlug}/users/{uid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const delta = reactionDelta(Boolean(before?.exists), Boolean(after?.exists));
    if (delta === 0) return;

    const { boardId, postId, stickerSlug } = event.params;
    const db = getFirestore();
    const postRef = db
      .collection("boards")
      .doc(boardId)
      .collection("posts")
      .doc(postId);

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
          logger.info("board reaction event already processed", {
            eventId: event.id,
            boardId,
            postId,
          });
        }
      });
      logger.info("board reaction count adjusted", {
        boardId,
        postId,
        stickerSlug,
        delta,
        eventId: event.id,
      });
    } catch (err) {
      logger.error("onBoardReactionWrite failed", {
        boardId,
        postId,
        stickerSlug,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
