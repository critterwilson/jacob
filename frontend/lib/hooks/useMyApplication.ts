"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type ApplicationStatus = "pending" | "approved" | "rejected";

export type MyApplication = {
  uid: string;
  email: string | null;
  displayName: string;
  photoURL: string | null;
  dob: string | null;
  age: number | null;
  isMinor: boolean;
  phone: string | null;
  location: string | null;
  faithBackground: string | null;
  status: ApplicationStatus;
  createdAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  parentalConsentObtained: boolean | null;
  parentalConsentNotes: string;
  rejectionReason: string;
  grandfathered: boolean;
};

export type UseMyApplicationResult =
  | { loading: true; application: null; error: null; refresh: () => Promise<void> }
  | {
      loading: false;
      application: MyApplication | null;
      error: ApiError | null;
      refresh: () => Promise<void>;
    };

/**
 * Polls `GET /api/applications/me`. Returns `application = null` when
 * the user has no application doc (404 from the backend); the
 * `/awaiting-approval` page treats that as "the onboarding form was
 * never submitted" and bounces back to `/onboarding`.
 *
 * Default interval is 30s — admin decisions take human time, and
 * faster polling would just burn rate-limit budget. Polling pauses
 * while `document.hidden` is true and resumes on visibility change,
 * matching the chat-polling pattern at `useGroupMessages.ts`.
 */
export function useMyApplication(opts: {
  uid: string | undefined;
  pollMs?: number;
}): UseMyApplicationResult {
  const { uid, pollMs = 30_000 } = opts;
  const [state, setState] = useState<{
    loading: boolean;
    application: MyApplication | null;
    error: ApiError | null;
  }>({ loading: true, application: null, error: null });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setState({ loading: false, application: null, error: null });
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const data = await apiGet<MyApplication>("/api/applications/me", {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      setState({ loading: false, application: data, error: null });
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code === "application_not_found") {
        setState({ loading: false, application: null, error: null });
        return;
      }
      if (err instanceof ApiError) {
        setState((prev) => ({
          loading: false,
          application: prev.application,
          error: err,
        }));
        return;
      }
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [uid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!uid) return;
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval !== null) return;
      interval = setInterval(() => {
        if (document.hidden) return;
        void load();
      }, pollMs);
    };

    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (!document.hidden) start();
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void load();
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [uid, pollMs, load]);

  return {
    loading: state.loading,
    application: state.application,
    error: state.error,
    refresh: load,
  } as UseMyApplicationResult;
}
