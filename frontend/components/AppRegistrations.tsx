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
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
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
