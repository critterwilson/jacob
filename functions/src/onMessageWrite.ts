import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

if (!getApps().length) {
  initializeApp();
}

export const onMessageWrite = onDocumentWritten(
  "groups/{gid}/messages/{mid}",
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

    if (!before?.exists && after?.exists) {
      await parentRef.update({
        threadReplyCount: FieldValue.increment(1),
        participants: FieldValue.arrayUnion(afterData!.authorUid as string),
      });
    } else if (before?.exists && after?.exists) {
      const wasSoftDeleted =
        beforeData?.deletedAt === null && afterData?.deletedAt != null;
      if (wasSoftDeleted) {
        await parentRef.update({
          threadReplyCount: FieldValue.increment(-1),
        });
      }
    }
  },
);
