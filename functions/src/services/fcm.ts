/**
 * FCM (Firebase Cloud Messaging) send helper with P8 circuit breaker.
 *
 * Each notification send goes through:
 *   1. Kill-switch (`FCM_DISABLED=true`).
 *   2. Circuit breaker (5 consecutive errors → open for 5 min).
 *   3. Actual `messaging.send()` call.
 *   4. `messaging/registration-token-not-registered` → caller must delete
 *      the stale device doc; this helper re-throws that error type as
 *      `StaleTokenError` so callers can distinguish it.
 *
 * Daily cap: callers (onNotificationCreate) are responsible for the
 * `FCM_DAILY_CAP` Firestore quota counter via `tryReserveFcmQuota`.
 */

import { getMessaging } from "firebase-admin/messaging";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { createCircuitBreaker } from "./circuitBreaker";

const FCM_DAILY_CAP = parseInt(process.env.FCM_DAILY_CAP ?? "100000", 10);
const QUOTA_WARN_RATIO = 0.8;

const _circuit = createCircuitBreaker();

export class StaleTokenError extends Error {
  constructor(token: string) {
    super(`stale FCM token: ${token.slice(0, 8)}…`);
    this.name = "StaleTokenError";
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function fcmStateRef() {
  return getFirestore().collection("fcm_state").doc(`quota-${todayKey()}`);
}

/**
 * Atomically reserve `slots` send slots in today's quota doc.
 * Returns the new usage count, or null if the cap would be exceeded.
 */
export async function tryReserveFcmQuota(slots: number = 1): Promise<number | null> {
  const ref = fcmStateRef();
  return getFirestore().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const current = (snap.data()?.count as number | undefined) ?? 0;
    if (current + slots > FCM_DAILY_CAP) {
      return null;
    }
    const next = current + slots;
    txn.set(ref, { count: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (next >= Math.floor(FCM_DAILY_CAP * QUOTA_WARN_RATIO)) {
      logger.warn("fcm_quota_warning", { count: next, cap: FCM_DAILY_CAP });
    }
    return next;
  });
}

export type FcmPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  /**
   * Required collapse key. Ensures retries deduplicate at the device level.
   * Conventions:
   *   - Group reply notifications:  `groupId:${gid}`
   *   - Mention notifications:      `mentionTarget:${uid}:${gid}:${msgId}`
   *   - Digest emails:              `digest:${uid}:${date}`
   * A missing collapseKey causes duplicate pushes on function retry (C5 fix).
   */
  collapseKey: string;
};

/**
 * Send an FCM message to a single registration token.
 *
 * Throws `StaleTokenError` when the token is no longer registered.
 * Throws `Error("circuit_open")` when the circuit is open.
 * Throws for other FCM errors after recording a circuit failure.
 */
export async function sendFcm(token: string, payload: FcmPayload): Promise<void> {
  if (process.env.FCM_DISABLED === "true") {
    logger.info("fcm_disabled: skipping send");
    return;
  }

  if (_circuit.isOpen()) {
    logger.warn("fcm_circuit_open: skipping send");
    throw new Error("circuit_open");
  }

  const messaging = getMessaging();
  try {
    await messaging.send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      android: { collapseKey: payload.collapseKey },
      apns: { headers: { "apns-collapse-id": payload.collapseKey } },
      webpush: {
        headers: { Topic: payload.collapseKey },
        notification: {
          icon: "/icons/icon-192x192.png",
          badge: "/icons/badge-96x96.png",
        },
      },
    });
    _circuit.recordSuccess();
  } catch (err) {
    const code = (err as { errorInfo?: { code: string } }).errorInfo?.code ?? "";
    if (code === "messaging/registration-token-not-registered") {
      throw new StaleTokenError(token);
    }
    _circuit.recordFailure();
    logger.error("fcm_send_failed", { error: (err as Error).message });
    throw err;
  }
}

export { _circuit as _fcmCircuit };
