import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

if (!getApps().length) {
  initializeApp();
}

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

    const beforeData = before?.data();
    const afterData = after?.data();

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

    // Determine the operation outside the transaction so we can skip early.
    const isCreate = !before?.exists && after?.exists;
    const isSoftDelete =
      before?.exists &&
      after?.exists &&
      beforeData?.deletedAt === null &&
      afterData?.deletedAt != null;
    const isHardDelete = before?.exists && !after?.exists;
    const isUndelete =
      before?.exists &&
      after?.exists &&
      beforeData?.deletedAt != null &&
      afterData?.deletedAt === null;

    if (!isCreate && !isSoftDelete) {
      // Hard deletes and undeletes don't change threadReplyCount.
      if (isHardDelete) {
        logger.warn("hard delete observed", { gid, mid: event.params.mid, eventId: event.id });
      }
      if (isUndelete) {
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

        if (isCreate) {
          txn.update(parentRef, {
            threadReplyCount: FieldValue.increment(1),
            participants: FieldValue.arrayUnion(afterData!.authorUid as string),
          });
          logger.info("thread reply counted", { gid, parentMessageId, eventId: event.id });
        } else if (isSoftDelete) {
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
