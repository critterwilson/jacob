"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type PendingRequest = {
  uid: string;
  displayName: string;
  photoURL: string | null;
  message: string;
  requestedAt: string;
  // Two-step minor approval: adults are "pending"; a minor awaiting the
  // group leader's vouch is "pending_leader" and shown with a distinct
  // card. Once a leader vouches, the request leaves this queue.
  status: "pending" | "pending_leader" | "approved" | "rejected";
  isMinor?: boolean;
  requiresOwnerReview?: boolean;
};

type PendingRequestsResponse = {
  requests: PendingRequest[];
  nextCursor: string | null;
};

export type JoinRequestsState =
  | { status: "loading" }
  | { status: "ok"; requests: PendingRequest[]; nextCursor: string | null }
  | { status: "error"; message: string };

export function useJoinRequests(gid: string | undefined) {
  const [state, setState] = useState<JoinRequestsState>({ status: "loading" });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!gid) {
      setState({ status: "ok", requests: [], nextCursor: null });
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setState({ status: "loading" });
    try {
      const res = await apiGet<PendingRequestsResponse>(
        `/api/groups/${gid}/join-requests`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      setState({ status: "ok", requests: res.requests, nextCursor: res.nextCursor });
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.code === "aborted") return;
      setState({
        status: "error",
        message:
          err instanceof ApiError
            ? err.message || `HTTP ${err.status}`
            : "Failed to load join requests",
      });
    }
  }, [gid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const pendingCount =
    state.status === "ok"
      ? state.requests.filter(
          (r: PendingRequest) =>
            r.status === "pending" || r.status === "pending_leader",
        ).length
      : 0;

  return { state, pendingCount, refresh: load };
}
