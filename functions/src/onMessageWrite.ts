import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

if (!getApps().length) {
  initializeApp();
}

// ── pure types for testability ────────────────────────────────────────────────

export type MessageData = {
  authorUid?: unknown;
  parentMessageId?: unknown;
  deletedAt?: unknown;
} & Record<string, unknown>;

export type ChangeKind =
  | "create"
  | "soft-delete"
  | "hard-delete"
  | "undelete"
  | "noop";

/**
 * Decide what kind of write this is. Pure function — easy to unit-test.
 */
export function classifyChange(
  beforeExists: boolean,
  afterExists: boolean,
  beforeDeletedAt: unknown,
  afterDeletedAt: unknown,
): ChangeKind {
  if (!beforeExists && afterExists) return "create";
  if (beforeExists && !afterExists) return "hard-delete";
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

// ── the trigger ───────────────────────────────────────────────────────────────

export const onMessageWrite = onDocumentWritten(
  {
    document: "groups/{gid}/messages/{mid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeData = before?.data() as MessageData | undefined;
    const afterData = after?.data() as MessageData | undefined;

    const parentMessageId =
      afterData?.parentMessageId ?? beforeData?.parentMessageId;
    if (!parentMessageId) return;

    const { gid } = event.params;
    const db = getFirestore();
    const parentRef = db
      .collection("groups")
      .doc(gid)
      .collection("messages")
      .doc(parentMessageId as string);

    const change = classifyChange(
      Boolean(before?.exists),
      Boolean(after?.exists),
      beforeData?.deletedAt ?? null,
      afterData?.deletedAt ?? null,
    );

    if (change !== "create" && change !== "soft-delete") {
      // Hard deletes and undeletes don't change threadReplyCount.
      if (change === "hard-delete") {
        logger.warn("hard delete observed", { gid, mid: event.params.mid, eventId: event.id });
      }
      if (change === "undelete") {
        logger.warn("undelete observed — possible rule gap", { gid, mid: event.params.mid });
      }
      return;
    }

    try {
      await db.runTransaction(async (txn) => {
        // Idempotency guard: skip if we already processed this event.
        const eventRef = parentRef.collection("_events").doc(event.id);
        const eventSnap = await txn.get(eventRef);
        if (eventSnap.exists) {
          logger.info("duplicate event skipped", { eventId: event.id });
          return;
        }
        txn.set(eventRef, { processedAt: FieldValue.serverTimestamp() });

        if (change === "create") {
          txn.update(parentRef, {
            threadReplyCount: FieldValue.increment(1),
            participants: FieldValue.arrayUnion(afterData!.authorUid as string),
          });
          logger.info("thread reply counted", { gid, parentMessageId, eventId: event.id });
        } else if (change === "soft-delete") {
          txn.update(parentRef, {
            threadReplyCount: FieldValue.increment(-1),
          });
          logger.info("thread reply decremented", { gid, parentMessageId, eventId: event.id });
        }
      });
    } catch (err) {
      logger.error("onMessageWrite transaction failed", {
        eventId: event.id,
        gid,
        parentMessageId,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
