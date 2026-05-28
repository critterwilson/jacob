"use client";

// T59 — active incidents hook.
//
// Fetches `GET /api/incidents` once on mount and refetches on tab
// focus/visibility-visible. Interval polling was removed (2026-05) per
// the project-wide "no polling outside chat" rule. Banner picks up
// new declarations the next time the user comes back to the tab —
// acceptable because incidents are operator-broadcast, not
// near-real-time signals.
//
// Failures are best-effort: previous list (or empty) is preserved so a
// network blip doesn't blow up the rest of the UI.

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGetConditional } from "@/lib/api";
import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";

export type ActiveIncident = {
  incidentId: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  title: string;
  body: string;
  createdBy: string | null;
  createdAt: string | null;
  displayUntil: string;
  acknowledged: boolean;
};

export function useActiveIncidents(): {
  incidents: ActiveIncident[];
  loading: boolean;
} {
  const [incidents, setIncidents] = useState<ActiveIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const etagRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await apiGetConditional<{ incidents: ActiveIncident[] }>(
        "/api/incidents",
        etagRef.current,
      );
      if (result.etag) etagRef.current = result.etag;
      if (result.status === 200 && result.data !== null) {
        setIncidents(result.data.incidents ?? []);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) {
        console.warn("incidents_load_failed", err.code, err.status);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useRefetchOnFocus(() => void load());

  return { incidents, loading };
}
