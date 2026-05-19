"use client";

// T59 — active incidents hook.
//
// Polls `GET /api/incidents` once on mount and revalidates every 60s.
// Mirrors the cadence of `useFlag` so the banner picks up new
// declarations within ~one minute. Failures are best-effort: if the
// API errors, the previous list (or empty) is preserved — we never
// want a Sentry/network blip to block the rest of the UI.

import { useEffect, useRef, useState } from "react";

import { ApiError, apiGetConditional } from "@/lib/api";

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

const REVALIDATE_INTERVAL_MS = 60_000;

export function useActiveIncidents(): {
  incidents: ActiveIncident[];
  loading: boolean;
} {
  const [incidents, setIncidents] = useState<ActiveIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const etagRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const result = await apiGetConditional<{ incidents: ActiveIncident[] }>(
          "/api/incidents",
          etagRef.current,
        );
        if (cancelled) return;
        if (result.etag) etagRef.current = result.etag;
        if (result.status === 200 && result.data !== null) {
          setIncidents(result.data.incidents ?? []);
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status !== 401) {
          console.warn("incidents_load_failed", err.code, err.status);
        }
        setLoading(false);
      }
    };

    void load();
    timer = setInterval(load, REVALIDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return { incidents, loading };
}
