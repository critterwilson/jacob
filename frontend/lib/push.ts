/**
 * T34 — FCM push token registration.
 *
 * Call `registerPushToken(uid)` after the user signs in and grants permission.
 * The function:
 *   1. Registers the Firebase Messaging service worker.
 *   2. Calls `getToken` with the VAPID key.
 *   3. Writes / updates `users/{uid}/devices/{deviceId}` in Firestore.
 *
 * `deviceId` is the first 16 hex chars of SHA-256(fcmToken) — stable across
 * token refreshes only if the token is unchanged.
 *
 * Disabled gracefully when:
 *   - `Notification` API unavailable (SSR, old browser).
 *   - `NEXT_PUBLIC_FIREBASE_VAPID_KEY` is not set.
 *   - User denies permission.
 */

import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { firestore } from "@/lib/firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";
const SW_PATH = "/firebase-messaging-sw.js";

function sha256hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle
    .digest("SHA-256", encoder.encode(input))
    .then((buf) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
}

export async function registerPushToken(uid: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window)) return null;
  if (!VAPID_KEY) {
    console.warn("[push] NEXT_PUBLIC_FIREBASE_VAPID_KEY not set — skipping push registration");
    return null;
  }

  if (Notification.permission === "denied") return null;

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

  const hash = await sha256hex(token);
  const deviceId = hash.slice(0, 16);

  await setDoc(
    doc(firestore, "users", uid, "devices", deviceId),
    {
      fcmToken: token,
      platform: "web",
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      userAgent: navigator.userAgent.slice(0, 256),
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    },
    { merge: true },
  );

  return deviceId;
}

/**
 * Update `lastSeenAt` for an existing device doc (debounced by caller).
 */
export async function touchDeviceLastSeen(uid: string, deviceId: string): Promise<void> {
  await setDoc(
    doc(firestore, "users", uid, "devices", deviceId),
    { lastSeenAt: serverTimestamp() },
    { merge: true },
  );
}
