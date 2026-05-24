"use client";

import { useEffect } from "react";

import { useAuth } from "@/lib/auth-context";
import { usePushSetup } from "@/lib/hooks/usePushSetup";

/**
 * Mounted once at the root of the app (under AuthProvider) so that the
 * service worker and FCM push setup register on every authed route, not
 * just routes inside the (authed) layout group. Previously these only
 * fired on /home and /settings/* (the only pages mounted under
 * (authed)/layout.tsx) — so navigating directly to /groups, /boards,
 * /devotionals, etc. left the SW unregistered and push tokens stale
 * until the user happened to visit one of those two pages. H-FRONT-4.
 *
 * Renders nothing.
 */

const SW_PATH = "/firebase-messaging-sw.js";

export function AppRegistrations() {
  const { user } = useAuth();
  usePushSetup(user?.uid ?? null);

  useEffect(() => {
    if (
      process.env.NEXT_PUBLIC_DISABLE_SW === "true" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    // Single SW for the whole origin: FCM push handling AND app-shell
    // caching live in the same script. Registering two SWs at the same
    // `scope: "/"` is undefined-behavior territory — the spec says the
    // second register() call updates the existing registration's
    // script, and whichever one calls skipWaiting() wins. Previously
    // the legacy `/sw.js` (which skipWaits) was beating
    // `/firebase-messaging-sw.js` (which didn't) on every page load,
    // leaving the active SW with no `push` handler and silently
    // dropping every FCM-delivered notification. The merged SW served
    // at `/firebase-messaging-sw.js` does both jobs.
    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .catch(() => undefined);

    // One-shot cleanup: unregister the legacy `/sw.js` on devices that
    // still carry it as a separate registration so it can't race with
    // the merged SW. Safe to leave in indefinitely — once every device
    // has moved on, getRegistration returns null and the call is a
    // no-op.
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => {
        if (reg && reg.active?.scriptURL.endsWith("/sw.js")) {
          void reg.unregister();
        }
      })
      .catch(() => undefined);

    return () => {
      if (process.env.NEXT_PUBLIC_DISABLE_SW === "true") {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => {
            regs.forEach((r) => void r.unregister());
          })
          .catch(() => undefined);
      }
    };
  }, []);

  return null;
}
