/**
 * T32 — maintain `boards/{boardId}/posts/{postId}.replyCount` when
 * replies are created or soft-deleted. Symmetric to `onMessageWrite.ts`'s
 * threadReplyCount logic. Idempotent via `_reply_events/{eventId}` under
 * the parent post.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { classifyPostChange, type ChangeKind } from "./onBoardPostWrite";
import { eventMarker } from "./services/eventMarkers";

if (!getApps().length) {
  initializeApp();
}

export const onBoardReplyWrite = onDocumentWritten(
  {
    document: "boards/{boardId}/posts/{postId}/replies/{replyId}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeData = before?.data() as Record<string, unknown> | undefined;
    const afterData = after?.data() as Record<string, unknown> | undefined;

    const change: ChangeKind = classifyPostChange(
      Boolean(before?.exists),
      Boolean(after?.exists),
      beforeData?.deletedAt ?? null,
      afterData?.deletedAt ?? null,
    );

    if (change === "noop" || change === "undelete") return;

    const { boardId, postId } = event.params;
    const db = getFirestore();
    const postRef = db
      .collection("boards")
      .doc(boardId)
      .collection("posts")
      .doc(postId);

    try {
      await db.runTransaction(async (txn) => {
        const eventRef = postRef.collection("_reply_events").doc(event.id);
        const eventSnap = await txn.get(eventRef);
        if (eventSnap.exists) {
          logger.info("duplicate board reply event skipped", {
            eventId: event.id,
            boardId,
            postId,
          });
          return;
        }
        txn.set(eventRef, eventMarker({ change }));

        const delta = change === "create" ? 1 : -1;
        txn.update(postRef, {
          replyCount: FieldValue.increment(delta),
        });
      });
      logger.info("board replyCount adjusted", {
        boardId,
        postId,
        change,
        eventId: event.id,
      });
    } catch (err) {
      logger.error("onBoardReplyWrite failed", {
        boardId,
        postId,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
