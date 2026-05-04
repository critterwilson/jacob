"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

/**
 * T38 — live status of the user's most recent self-serve export job.
 *
 * After M2 of the data-layer migration, the hook polls
 * `GET /api/account/export/status` every 5s while a job is in flight
 * (queued or processing) and every 30s otherwise. The previous Firestore
 * listener tracked field-level changes; the polling cadence here is
 * tight enough that ready/failed transitions still feel snappy.
 */

export type ExportStatus =
  | "none"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "expired";

export type ExportJob = {
  jobId: string;
  status: ExportStatus;
  requestedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  failureReason: string | null;
  byteCount: number | null;
  downloadUrl: string | null;
  schemaVersion: number;
};

type ExportJobResponse = {
  jobId: string;
  status: ExportStatus;
  requestedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  byteCount: number | null;
  schemaVersion: number;
  downloadUrl: string | null;
};

const DEFAULT: ExportJob = {
  jobId: "",
  status: "none",
  requestedAt: null,
  completedAt: null,
  expiresAt: null,
  failureReason: null,
  byteCount: null,
  downloadUrl: null,
  schemaVersion: 1,
};

const ACTIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 30_000;

function isInFlight(s: ExportStatus): boolean {
  return s === "queued" || s === "processing";
}

function toJob(res: ExportJobResponse): ExportJob {
  return {
    jobId: res.jobId,
    status: res.status,
    requestedAt: res.requestedAt ? new Date(res.requestedAt) : null,
    completedAt: res.completedAt ? new Date(res.completedAt) : null,
    expiresAt: res.expiresAt ? new Date(res.expiresAt) : null,
    failureReason: res.failureReason ?? null,
    byteCount: res.byteCount ?? null,
    downloadUrl: res.downloadUrl ?? null,
    schemaVersion: res.schemaVersion ?? 1,
  };
}

export function useExportStatus(uid: string | undefined): ExportJob {
  const [job, setJob] = useState<ExportJob>(DEFAULT);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!uid) {
      setJob(DEFAULT);
      return;
    }
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;
    let lastStatus: ExportStatus = "none";

    const tick = async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await apiGet<ExportJobResponse>("/api/account/export/status", {
          signal: ctl.signal,
        });
        if (cancelled) return;
        const next = toJob(res);
        lastStatus = next.status;
        setJob(next);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("export_status_fetch_failed", err.code, err.status);
        }
        // Don't clobber a known job state with DEFAULT on a transient
        // error — keep showing what we last knew until the next tick.
      } finally {
        if (cancelled) return;
        const ms = isInFlight(lastStatus) ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
        handle = setTimeout(tick, ms);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
      abortRef.current?.abort();
    };
  }, [uid]);

  return job;
}
