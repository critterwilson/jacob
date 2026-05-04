/**
 * T32 — maintain `boards/{boardId}.postCount` when posts are created or
 * soft-deleted (deletedAt: null → non-null). Mirrors `onMessageWrite.ts`
 * threadReplyCount logic. Idempotent via `_events/{eventId}` markers
 * under each board (per P3).
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import { eventMarker } from "./services/eventMarkers";

if (!getApps().length) {
  initializeApp();
}

export type ChangeKind = "create" | "soft-delete" | "undelete" | "noop";

export function classifyPostChange(
  beforeExists: boolean,
  afterExists: boolean,
  beforeDeletedAt: unknown,
  afterDeletedAt: unknown,
): ChangeKind {
  if (!beforeExists && afterExists) return "create";
  if (
    beforeExists &&
    afterExists &&
    beforeDeletedAt === null &&
    afterDeletedAt != null
  ) {
    return "soft-delete";
  }
  if (
    beforeExists &&
    afterExists &&
    beforeDeletedAt != null &&
    afterDeletedAt === null
  ) {
    return "undelete";
  }
  return "noop";
}

export const onBoardPostWrite = onDocumentWritten(
  {
    document: "boards/{boardId}/posts/{postId}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeData = before?.data() as Record<string, unknown> | undefined;
    const afterData = after?.data() as Record<string, unknown> | undefined;

    const change = classifyPostChange(
      Boolean(before?.exists),
      Boolean(after?.exists),
      beforeData?.deletedAt ?? null,
      afterData?.deletedAt ?? null,
    );

    if (change === "noop" || change === "undelete") return;

    const { boardId } = event.params;
    const db = getFirestore();
    const boardRef = db.collection("boards").doc(boardId);

    try {
      await db.runTransaction(async (txn) => {
        const eventRef = boardRef.collection("_post_events").doc(event.id);
        const eventSnap = await txn.get(eventRef);
        if (eventSnap.exists) {
          logger.info("duplicate board post event skipped", {
            eventId: event.id,
            boardId,
          });
          return;
        }
        txn.set(eventRef, eventMarker({ change }));

        const delta = change === "create" ? 1 : -1;
        txn.update(boardRef, {
          postCount: FieldValue.increment(delta),
        });
      });
      logger.info("board postCount adjusted", {
        boardId,
        change,
        eventId: event.id,
      });
    } catch (err) {
      logger.error("onBoardPostWrite failed", {
        boardId,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
