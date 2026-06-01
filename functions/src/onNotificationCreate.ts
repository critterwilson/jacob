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
  kind:
    | "announcement"
    | "mention"
    | "board_mention"
    | "reply"
    | "digest_send"
    | "ministry_post"
    | "group_message";
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
  ministryFeed: boolean;
  groupMessages: boolean;
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
  ministry_post: "ministryFeed",
  group_message: "groupMessages",
};

/** Exported for unit tests. */
export function kindToPrefKey(kind: string): keyof PrefDoc | null {
  return KIND_TO_PREF[kind] ?? null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/**
 * The in-app path a notification should open when tapped.
 *
 * Surfaced as `link` on the FCM payload and forwarded to the service
 * worker (see services/fcm.ts), where our notificationclick handler opens
 * it. Without it, tapping an Android web push just cleared the
 * notification without opening the app. Always a scope-anchored relative
 * path (leading "/") so the SW can resolve it against its own origin.
 *
 * Exported for unit tests.
 */
export function deepLinkFor(notif: {
  kind: string;
  groupId?: string | null;
  messageRef?: string | null;
  boardId?: string | null;
}): string {
  const gid = notif.groupId;
  switch (notif.kind) {
    case "ministry_post":
      return "/feed";
    case "board_mention":
      return notif.boardId ? `/boards/${notif.boardId}` : "/boards";
    case "announcement":
    case "mention":
    case "reply":
    case "group_message":
      return gid ? `/groups/${gid}` : "/home";
    default:
      return gid ? `/groups/${gid}` : "/home";
  }
}

/** Exported for unit tests. */
export function buildPayload(
  notif: Pick<NotificationDoc, "kind" | "body" | "groupId" | "messageRef" | "boardId">,
  recipientUid: string,
): FcmPayload {
  const body = truncate(notif.body ?? "", 100);
  const gid = notif.groupId ?? "unknown";
  const msgId = notif.messageRef?.split("/").pop() ?? "unknown";
  // Every push carries a deep link so a tap opens the relevant surface.
  const link = deepLinkFor(notif);
  switch (notif.kind) {
    case "announcement":
      return { title: "📢 Announcement", body, link, collapseKey: `announcement:${gid}` };
    case "mention":
    case "board_mention":
      // `m:${msgId}` — msgId (a Firestore auto-id, or postId for
      // board_mention) is unique per message, so per-message collapse
      // is already correct without including recipient/group. The
      // previous `mentionTarget:${uid}:${gid}:${msgId}` form was ~85
      // bytes for real-length ids and exceeded APNs' 64-byte
      // `apns-collapse-id` limit, making every mention push fail.
      return {
        title: "💬 You were mentioned",
        body,
        link,
        collapseKey: `m:${msgId}`,
      };
    case "reply":
      return { title: "↩️ New reply to your message", body, link, collapseKey: `groupId:${gid}` };
    case "ministry_post":
      return {
        title: "✝️ New ministry post",
        body,
        link,
        collapseKey: `ministry_post:${msgId}`,
      };
    case "group_message":
      // One push per group at a time — bursts collapse onto the latest
      // message in a chatty group instead of stacking up.
      return {
        title: "💬 New message",
        body,
        link,
        collapseKey: `group_message:${gid}`,
      };
    default:
      return { title: "JACOB", body, link, collapseKey: `notif:${recipientUid}` };
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
    //
    // The marker is written AFTER the enqueue loop (M3), not before. Writing
    // it up-front means a partial enqueue failure leaves the marker set with
    // some tasks never queued — and with `retry: false`, the trigger is not
    // re-invoked, so those devices are permanently silent. By writing after,
    // an enqueue failure leaves the marker unset, so any redelivery retries
    // the whole loop. Workers can idempotency-check by `(notifPath, deviceId)`
    // directly if a redelivery does produce duplicate tasks.
    const eventRef = notifRef.collection("_events").doc(event.id);
    const eventSnap = await eventRef.get();
    if (eventSnap.exists) {
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

    // Initialise the counters BEFORE enqueuing so a worker that lands
    // between `enqueue()` and the trigger's post-loop write can't be
    // clobbered by a hard `delivered: 0` / `failed: 0` reset. Workers
    // race each other safely because `FieldValue.increment` is
    // commutative; the post-loop write only updates `enqueued` totals.
    await notifRef.update({
      enqueuedAt: FieldValue.serverTimestamp(),
      delivered: 0,
      failed: 0,
    });

    // H2: enqueue one Cloud Task per device. The `sendFcmTask` worker
    // (in sendFcmTask.ts) handles the FCM send and incrementally
    // updates `delivered`/`failed` counters on this notif doc. The
    // per-task retry budget is independent of this trigger's lifetime,
    // so a slow FCM call no longer holds the trigger open.
    //
    // M8: enqueue in parallel. A 200-member announcement with 2 devices
    // each would otherwise issue 400 sequential round-trips to the Cloud
    // Tasks API.
    const queue = getFunctions().taskQueue<SendFcmTaskPayload>("sendFcmTask");
    const enqueueResults = await Promise.all(
      devicesSnap.docs.map(async (deviceSnap): Promise<number> => {
        const device = deviceSnap.data() as DeviceDoc;
        const token = device.fcmToken;
        if (!token) return 0;
        await queue.enqueue({
          uid,
          deviceId: deviceSnap.id,
          fcmToken: token,
          notifPath: notifRef.path,
          fcmPayload: payload,
        });
        return 1;
      }),
    );
    const enqueued = enqueueResults.reduce((a, b) => a + b, 0);

    await notifRef.update({ enqueued });

    // M3: mark this event processed only after all tasks are successfully
    // enqueued. If Promise.all above rejects, we never reach this line and
    // the marker stays unset, so any redelivery retries cleanly.
    await eventRef.set(eventMarker());

    logger.info("notification_dispatched", {
      uid,
      nid,
      kind: notif.kind,
      enqueued,
      deviceCount,
    });
  },
);
