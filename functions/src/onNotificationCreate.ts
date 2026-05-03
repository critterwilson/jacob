/**
 * T34 — FCM push dispatch on notification create.
 *
 * Fires when a `users/{uid}/notifications/{nid}` doc is created (by the
 * backend or another Cloud Function). Reads the user's notification prefs
 * and device list, sends FCM to each registered device, then stamps the
 * notification doc with `deliveredAt` or `failedAt`.
 *
 * Idempotency: the trigger fires once per create. Retried delivery
 * re-sends, but FCM deduplicates within 4 h via `collapse_key`.
 *
 * P3 options: region us-central1, maxInstances 10, retry false.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { sendFcm, StaleTokenError, tryReserveFcmQuota, type FcmPayload } from "./services/fcm";

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
    let successCount = 0;
    let lastFailureReason = "";
    const sends = devicesSnap.docs.map(async (deviceSnap) => {
      const device = deviceSnap.data() as DeviceDoc;
      const token = device.fcmToken;
      if (!token) return;

      try {
        await sendFcm(token, payload);
        successCount++;
        logger.info("fcm_sent", { uid, nid, deviceId: deviceSnap.id });
      } catch (err) {
        if (err instanceof StaleTokenError) {
          logger.info("stale_token_deleted", { uid, deviceId: deviceSnap.id });
          await deviceSnap.ref.delete();
          return;
        }
        lastFailureReason = (err as Error).message;
        logger.error("fcm_send_error", { uid, nid, deviceId: deviceSnap.id, error: lastFailureReason });
      }
    });

    await Promise.allSettled(sends);

    if (successCount > 0) {
      await notifRef.update({
        deliveredAt: FieldValue.serverTimestamp(),
        delivered: successCount,
        failed: deviceCount - successCount,
      });
    } else {
      await notifRef.update({
        failedAt: FieldValue.serverTimestamp(),
        failureReason: lastFailureReason || "all_devices_failed",
        delivered: 0,
        failed: deviceCount,
      });
    }
    logger.info("notification_dispatched", { uid, nid, kind: notif.kind, successCount, deviceCount });
  },
);
