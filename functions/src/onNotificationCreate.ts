/**
 * T34 — FCM push dispatch on notification create.
 *
 * Fires when a `users/{uid}/notifications/{nid}` doc is created (by the
 * backend or another Cloud Function). Reads the user's notification prefs
 * and device list, sends FCM to each registered device, then stamps the
 * notification doc with `deliveredAt` or `failedAt`.
 *
 * Idempotency: Cloud Functions delivery is at-least-once. We dedupe on
 * `event.id` via a marker doc at
 * `users/{uid}/notifications/{nid}/_events/{eventId}`, written inside a
 * transaction before any task is enqueued. Same pattern as
 * `onMessageWrite.ts` and `onReactionWrite.ts`.
 *
 * P3 options: region us-central1, maxInstances 10, retry false.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getApps, initializeApp } from "firebase-admin/app";

import { tryReserveFcmQuota, type FcmPayload } from "./services/fcm";
import type { SendFcmTaskPayload } from "./sendFcmTask";
import { eventMarker } from "./services/eventMarkers";

if (!getApps().length) {
  initializeApp();
}

type NotificationDoc = {
  kind: "announcement" | "mention" | "board_mention" | "reply" | "digest_send";
  groupId?: string;
  boardId?: string;
  messageRef?: string;
  fromUid?: string;
  body?: string;
  createdAt?: unknown;
  readAt?: unknown;
  deliveredAt?: unknown;
  failedAt?: unknown;
};

type PrefDoc = {
  mentions: boolean;
  replies: boolean;
  announcements: boolean;
  digest: boolean;
};

type DeviceDoc = {
  fcmToken: string;
  platform: string;
  lastSeenAt?: unknown;
};

const KIND_TO_PREF: Record<string, keyof PrefDoc | null> = {
  announcement: "announcements",
  mention: "mentions",
  board_mention: "mentions",
  reply: "replies",
  digest_send: "digest",
};

/** Exported for unit tests. */
export function kindToPrefKey(kind: string): keyof PrefDoc | null {
  return KIND_TO_PREF[kind] ?? null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/** Exported for unit tests. */
export function buildPayload(
  notif: Pick<NotificationDoc, "kind" | "body" | "groupId" | "messageRef">,
  recipientUid: string,
): FcmPayload {
  const body = truncate(notif.body ?? "", 100);
  const gid = notif.groupId ?? "unknown";
  const msgId = notif.messageRef?.split("/").pop() ?? "unknown";
  switch (notif.kind) {
    case "announcement":
      return { title: "📢 Announcement", body, collapseKey: `announcement:${gid}` };
    case "mention":
    case "board_mention":
      return {
        title: "💬 You were mentioned",
        body,
        collapseKey: `mentionTarget:${recipientUid}:${gid}:${msgId}`,
      };
    case "reply":
      return { title: "↩️ New reply to your message", body, collapseKey: `groupId:${gid}` };
    default:
      return { title: "JACOB", body, collapseKey: `notif:${recipientUid}` };
  }
}

export const onNotificationCreate = onDocumentCreated(
  {
    document: "users/{uid}/notifications/{nid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const { uid, nid } = event.params;
    const notif = event.data?.data() as NotificationDoc | undefined;
    if (!notif) return;

    const db = getFirestore();
    const notifRef = db.collection("users").doc(uid).collection("notifications").doc(nid);

    // Idempotency guard: bail if we have already processed this event id.
    // Cloud Functions delivery is at-least-once; without this every redelivery
    // would re-enqueue the per-device FCM tasks and produce duplicate pushes.
    const eventRef = notifRef.collection("_events").doc(event.id);
    const reserved = await db.runTransaction(async (txn) => {
      const eventSnap = await txn.get(eventRef);
      if (eventSnap.exists) return false;
      txn.set(eventRef, eventMarker());
      return true;
    });
    if (!reserved) {
      logger.info("notification_event_already_processed", { uid, nid, eventId: event.id });
      return;
    }

    const prefKey = KIND_TO_PREF[notif.kind] ?? null;
    if (prefKey !== null) {
      const prefSnap = await db
        .collection("users")
        .doc(uid)
        .collection("notificationPrefs")
        .doc("main")
        .get();
      const prefs = prefSnap.data() as PrefDoc | undefined;
      if (prefs && prefs[prefKey] === false) {
        logger.info("notification pref disabled", { uid, kind: notif.kind, nid });
        return;
      }
    }

    const devicesSnap = await db
      .collection("users")
      .doc(uid)
      .collection("devices")
      .get();

    if (devicesSnap.empty) {
      logger.info("no devices for user", { uid, nid });
      return;
    }

    const deviceCount = devicesSnap.size;
    const quota = await tryReserveFcmQuota(deviceCount);
    if (quota === null) {
      logger.warn("fcm_quota_exceeded", { uid, nid });
      await notifRef.update({
        failedAt: FieldValue.serverTimestamp(),
        failureReason: "quota_exceeded",
      });
      return;
    }

    const payload = buildPayload(notif, uid);

    // H2: enqueue one Cloud Task per device. The `sendFcmTask` worker
    // (in sendFcmTask.ts) handles the FCM send and incrementally
    // updates `delivered`/`failed` counters on this notif doc. The
    // per-task retry budget is independent of this trigger's lifetime,
    // so a slow FCM call no longer holds the trigger open.
    const queue = getFunctions().taskQueue<SendFcmTaskPayload>("sendFcmTask");
    let enqueued = 0;
    for (const deviceSnap of devicesSnap.docs) {
      const device = deviceSnap.data() as DeviceDoc;
      const token = device.fcmToken;
      if (!token) continue;
      await queue.enqueue({
        uid,
        deviceId: deviceSnap.id,
        fcmToken: token,
        notifPath: notifRef.path,
        fcmPayload: payload,
      });
      enqueued += 1;
    }

    // Initialise the counters so the worker's `FieldValue.increment`
    // calls land on a known shape. Workers race each other safely
    // because increment is commutative.
    await notifRef.update({
      enqueued,
      enqueuedAt: FieldValue.serverTimestamp(),
      delivered: 0,
      failed: 0,
    });

    logger.info("notification_dispatched", {
      uid,
      nid,
      kind: notif.kind,
      enqueued,
      deviceCount,
    });
  },
);
