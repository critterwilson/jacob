"use client";

import { useEffect, useState } from "react";

export function useMaintenanceBanner() {
  const [maintenance, setMaintenance] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchFlag() {
      try {
        const [
          { getRemoteConfig, fetchAndActivate, getBoolean },
          { app },
        ] = await Promise.all([
          import("firebase/remote-config"),
          import("@/lib/firebase"),
        ]);
        const rc = getRemoteConfig(app);
        rc.settings.minimumFetchIntervalMillis = 3_600_000;
        rc.defaultConfig = { maintenance_mode: false };
        await fetchAndActivate(rc);
        if (!cancelled) setMaintenance(getBoolean(rc, "maintenance_mode"));
      } catch {
        // Remote Config unavailable in emulator or network error — no banner
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchFlag();
    return () => {
      cancelled = true;
    };
  }, []);

  return { maintenance, loading };
}
