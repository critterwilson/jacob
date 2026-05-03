"use client";

import { useEffect, useRef } from "react";
import { registerPushToken, touchDeviceLastSeen } from "@/lib/push";

const TOUCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Called once per authed session from the layout. Registers the FCM service
 * worker, requests permission if needed, and writes/refreshes the device doc.
 * The per-hour touch is debounced via a sessionStorage flag so it doesn't fire
 * on every re-render.
 */
export function usePushSetup(uid: string | null) {
  const deviceIdRef = useRef<string | null>(null);
  const lastTouchRef = useRef<number>(0);

  useEffect(() => {
    if (!uid) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    (async () => {
      const deviceId = await registerPushToken(uid);
      if (cancelled) return;
      deviceIdRef.current = deviceId;
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Refresh lastSeenAt at most once per hour per session.
  useEffect(() => {
    if (!uid) return;

    const touch = async () => {
      const now = Date.now();
      if (now - lastTouchRef.current < TOUCH_INTERVAL_MS) return;
      const deviceId = deviceIdRef.current;
      if (!deviceId) return;
      lastTouchRef.current = now;
      await touchDeviceLastSeen(uid, deviceId);
    };

    void touch();
  });
}
