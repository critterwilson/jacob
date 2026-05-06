/**
 * H2 — per-device FCM dispatch via Cloud Tasks.
 *
 * Before this trigger landed, `onNotificationCreate.ts` did a single
 * `Promise.allSettled` across every device the recipient had registered.
 * That's fine for 1–3 devices but couples the lifetime of the
 * notification trigger to the slowest FCM call, and gives the trigger
 * no per-device retry budget.
 *
 * Now `onNotificationCreate.ts` enqueues one task per device into the
 * `sendFcmTask` queue (defined here). Each task runs as its own
 * function invocation: one FCM call per task, isolated retry budget,
 * isolated logs. The notification doc accumulates `delivered`/`failed`
 * counters via `FieldValue.increment`.
 *
 * Free-tier cap: 1 M task creations/month — well past ministry scale.
 */

import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { sendFcm, StaleTokenError, type FcmPayload } from "./services/fcm";

if (!getApps().length) {
  initializeApp();
}

/**
 * Task payload shape. Kept narrow so a future schema change surfaces as
 * a TypeScript error at the enqueue site (in onNotificationCreate.ts).
 */
export type SendFcmTaskPayload = {
  uid: string;
  deviceId: string;
  fcmToken: string;
  notifPath: string; // `users/{uid}/notifications/{nid}` for incremental updates
  fcmPayload: FcmPayload;
};

/**
 * Pure handler — exported for unit tests so we can drive it without the
 * full Cloud Tasks → Functions framework. The trigger below is a thin
 * wrapper.
 */
export async function processSendFcmTask(
  data: SendFcmTaskPayload,
  deps: {
    db?: ReturnType<typeof getFirestore>;
    sendFcmFn?: (token: string, payload: FcmPayload) => Promise<void>;
  } = {},
): Promise<{ status: "delivered" | "stale_token" | "failed"; reason?: string }> {
  const db = deps.db ?? getFirestore();
  const sendFcmImpl = deps.sendFcmFn ?? sendFcm;
  const notifRef = db.doc(data.notifPath);

  try {
    await sendFcmImpl(data.fcmToken, data.fcmPayload);
    await notifRef.set(
      {
        delivered: FieldValue.increment(1),
        deliveredAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    logger.info("fcm_task_delivered", {
      uid: data.uid,
      deviceId: data.deviceId,
      notifPath: data.notifPath,
    });
    return { status: "delivered" };
  } catch (err) {
    if (err instanceof StaleTokenError) {
      // Stale token: delete the device doc + bump the failed counter.
      await db
        .doc(`users/${data.uid}/devices/${data.deviceId}`)
        .delete()
        .catch(() => {
          // Already deleted by another task — fine.
        });
      await notifRef.set({ failed: FieldValue.increment(1) }, { merge: true });
      logger.info("fcm_task_stale_token_deleted", {
        uid: data.uid,
        deviceId: data.deviceId,
      });
      return { status: "stale_token" };
    }
    const reason = (err as Error).message;
    await notifRef.set(
      {
        failed: FieldValue.increment(1),
        failureReason: reason,
        failedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    logger.error("fcm_task_failed", {
      uid: data.uid,
      deviceId: data.deviceId,
      error: reason,
    });
    return { status: "failed", reason };
  }
}

export const sendFcmTask = onTaskDispatched(
  {
    region: "us-central1",
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 5,
    },
    rateLimits: {
      // Cap concurrent FCM dispatch so a notification storm can't drain
      // the daily quota in seconds. 50 / second is well clear of FCM's
      // own per-project rate limit (~600 msg/s sustained).
      maxDispatchesPerSecond: 50,
    },
  },
  async (req) => {
    await processSendFcmTask(req.data as SendFcmTaskPayload);
  },
);
