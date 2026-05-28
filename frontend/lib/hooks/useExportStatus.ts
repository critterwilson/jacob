"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";
import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";

/**
 * T38 — current self-serve export job status.
 *
 * Interval polling was removed (2026-05) per the project-wide "no
 * polling outside chat" rule. We fetch on mount and refetch on tab
 * focus. Realistic flow: user requests an export, alt-tabs away to
 * wait, comes back → focus refetch shows "ready". An explicit
 * `refresh()` is returned for callers that want a manual button.
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

export function useExportStatus(uid: string | undefined): ExportJob & { refresh: () => void } {
  const [job, setJob] = useState<ExportJob>(DEFAULT);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await apiGet<ExportJobResponse>("/api/account/export/status", {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      setJob(toJob(res));
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("export_status_fetch_failed", err.code, err.status);
      }
      // Don't clobber a known state with DEFAULT on transient errors.
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setJob(DEFAULT);
      return;
    }
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [uid, load]);

  useRefetchOnFocus(() => void load(), { enabled: !!uid });

  return { ...job, refresh: () => void load() };
}
