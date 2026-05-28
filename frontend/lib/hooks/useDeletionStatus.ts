"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";
import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";

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
 * `GET /api/account/delete/status` — fetch on mount + refetch on tab
 * focus. Replaces the prior 60s interval (and the older Firestore
 * onSnapshot listener it migrated from). The grace-window state
 * changes on the order of seconds-to-minutes, so focus refetch is
 * tight enough for the deletion banner and the delete-account page.
 */
export function useDeletionStatus(uid: string | undefined): DeletionStatus {
  const [status, setStatus] = useState<DeletionStatus>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await apiGet<DeleteStatusResponse>(
        "/api/account/delete/status",
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
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
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code !== "aborted") {
        console.warn("deletion_status_fetch_failed", err.code, err.status);
      }
      setStatus(EMPTY);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setStatus(EMPTY);
      return;
    }
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [uid, load]);

  useRefetchOnFocus(() => void load(), { enabled: !!uid });

  return status;
}
