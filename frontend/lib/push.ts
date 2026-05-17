/**
 * T34 — FCM push token registration.
 *
 * Call `registerPushToken(uid)` after the user signs in and grants permission.
 * The function:
 *   1. Registers the Firebase Messaging service worker.
 *   2. Calls `getToken` with the VAPID key.
 *   3. Sends the token to `POST /api/users/me/devices`, which dedupes
 *      against the user's existing devices and writes the doc with the
 *      Admin SDK (M2 of the data-layer migration).
 *
 * The backend returns the canonical `deviceId`. Token-rotation is
 * handled server-side via the dedupe-on-fcmToken path so a client
 * re-registering after a token refresh always gets back the same id.
 *
 * Disabled gracefully when:
 *   - `Notification` API unavailable (SSR, old browser).
 *   - `NEXT_PUBLIC_FIREBASE_VAPID_KEY` is not set.
 *   - `Notification.permission !== "granted"` — never auto-prompt. The
 *     browser permission prompt is fired explicitly by `PushPrompt` (an
 *     in-app CTA) and the `/settings/notifications` re-enable affordance.
 *     If we called `getToken` while permission is `"default"`, firebase/
 *     messaging would surface the native prompt on every authed render.
 */

import { ApiError, apiPost } from "@/lib/api";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";
const SW_PATH = "/firebase-messaging-sw.js";

type RegisterDeviceRequest = {
  fcmToken: string;
  platform: "web" | "ios" | "android";
  userAgent: string;
  appVersion: string | null;
};

type DeviceResponse = {
  deviceId: string;
  registeredAt: string;
};

export async function registerPushToken(uid: string): Promise<string | null> {
  // uid is part of the public API; the backend resolves the caller from
  // the verified ID token, so the parameter is no longer threaded into
  // the request body. Kept for callers and to make the intent clear.
  void uid;

  if (typeof window === "undefined") return null;
  if (!("Notification" in window)) return null;
  if (!VAPID_KEY) {
    console.warn("[push] NEXT_PUBLIC_FIREBASE_VAPID_KEY not set — skipping push registration");
    return null;
  }

  // Gate strictly on `"granted"`. `"default"` would cause `getToken` to
  // open the native permission prompt — see the file header.
  if (Notification.permission !== "granted") return null;

  const { getMessaging, getToken } = await import("firebase/messaging");
  const { app } = await import("@/lib/firebase");

  let swReg: ServiceWorkerRegistration;
  try {
    swReg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    // Wait for the SW to activate before posting config; on first install
    // swReg.active is null until the installing worker transitions to active.
    const config = (app as unknown as { options: Record<string, unknown> }).options;
    const active =
      swReg.active ??
      (await new Promise<ServiceWorker>((resolve) => {
        const worker = swReg.installing ?? swReg.waiting;
        if (!worker) return;
        worker.addEventListener("statechange", function handler() {
          if (worker.state === "activated") {
            worker.removeEventListener("statechange", handler);
            resolve(worker);
          }
        });
      }));
    active?.postMessage({ type: "FIREBASE_CONFIG", config });
  } catch (err) {
    console.warn("[push] SW registration failed:", err);
    return null;
  }

  let token: string;
  try {
    const messaging = getMessaging(app);
    token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
  } catch (err) {
    console.warn("[push] getToken failed:", err);
    return null;
  }

  try {
    const res = await apiPost<DeviceResponse, RegisterDeviceRequest>(
      "/api/users/me/devices",
      {
        fcmToken: token,
        platform: "web",
        userAgent: navigator.userAgent.slice(0, 256),
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
      },
    );
    return res.deviceId;
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn("[push] device register failed:", err.code, err.status);
    } else {
      console.warn("[push] device register failed:", err);
    }
    return null;
  }
}

/**
 * Re-register the device to refresh `lastSeenAt`. The backend updates
 * the existing doc when it sees a known fcmToken, so calling
 * `registerPushToken` again is the canonical "touch" — but the original
 * helper's caller (`usePushSetup`) still needs a stable shape, so we
 * keep it as a thin re-entry wrapper.
 */
export async function touchDeviceLastSeen(uid: string, deviceId: string): Promise<void> {
  void deviceId; // back-compat parameter; the backend keys by fcmToken
  await registerPushToken(uid);
}
