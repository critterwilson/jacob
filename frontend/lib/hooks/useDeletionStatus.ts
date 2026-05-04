"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

type DeleteStatusResponse = {
  status: "none" | "pending";
  deletionRequestedAt?: string | null;
  finalizeAt?: string | null;
  keepBody?: boolean | null;
};

export type DeletionStatus = {
  pending: boolean;
  finalizeAt: Date | null;
  keepBody: boolean;
};

const EMPTY: DeletionStatus = {
  pending: false,
  finalizeAt: null,
  keepBody: true,
};

/**
 * Replaces the prior `onSnapshot(users/{uid})` listener with a poll
 * against `GET /api/account/delete/status`. Polls every 60s while the
 * hook is mounted; the deletion-banner / delete-account page mounts the
 * hook for as long as the user is on those views, which is enough — a
 * grace-window state change is already on the order of seconds-to-minutes.
 */
export function useDeletionStatus(uid: string | undefined): DeletionStatus {
  const [status, setStatus] = useState<DeletionStatus>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!uid) {
      setStatus(EMPTY);
      return;
    }
    let cancelled = false;

    const fetchOnce = async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await apiGet<DeleteStatusResponse>(
          "/api/account/delete/status",
          { signal: ctl.signal },
        );
        if (cancelled) return;
        if (res.status === "pending" && res.finalizeAt) {
          setStatus({
            pending: true,
            finalizeAt: new Date(res.finalizeAt),
            keepBody: res.keepBody !== false,
          });
        } else {
          setStatus(EMPTY);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          // Treat any error as "no pending" — better to under-show the
          // banner than to render a stale one against the wrong state.
          console.warn("deletion_status_fetch_failed", err.code, err.status);
        }
        setStatus(EMPTY);
      }
    };

    void fetchOnce();
    const handle = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
      abortRef.current?.abort();
    };
  }, [uid]);

  return status;
}
