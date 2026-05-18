"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

// Public profile shape returned by the bootstrap endpoint. Mirrors
// `backend/app/models/users.py:UserProfile` and the previous Firestore
// document layout so callers don't need to change.
export type UserProfile = {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  role: string;
  schemaVersion: number;
  isMinor: boolean;
  createdAt: string | null;
  phone?: string | null;
  location?: string | null;
  faithBackground?: string | null;
};

export type BootstrapResponse = {
  profile: UserProfile | null;
  hasProfile: boolean;
  claims: { admin: boolean };
  deletionRequestedAt: string | null;
  // ADR 0012 — `null` when no application doc exists (legacy /
  // grandfathered users); otherwise one of "pending" / "approved" /
  // "rejected".
  applicationStatus: "pending" | "approved" | "rejected" | null;
};

export type UseUserResult =
  | { loading: true; profile: null; refresh: () => Promise<void> }
  | { loading: false; profile: UserProfile; refresh: () => Promise<void> }
  | { loading: false; profile: null; refresh: () => Promise<void> };

/**
 * Write the `jacob-has-profile` cookie on the frontend origin.
 *
 * The backend also sets this cookie on the bootstrap response, but in
 * environments where the frontend and API live on different hosts (e.g.
 * staging — `jacob-frontend--*.hosted.app` vs `jacob-backend-*.run.app`)
 * the browser saves the API's `Set-Cookie` against the API's origin,
 * not the frontend's. The Next.js middleware reads cookies from *its*
 * origin, so without this client-side mirror the user gets stuck on
 * `/onboarding` even after a successful bootstrap. Closes H3.
 *
 * In production (single-origin via App Hosting → Cloud Run rewrite)
 * this is a harmless duplicate write.
 */
export function setHasProfileCookie(hasProfile: boolean): void {
  if (typeof document === "undefined") return;
  // Same-origin prod already received Set-Cookie from the backend, so
  // the cookie is on this document. Skip the redundant write to keep
  // dev-tools noise down. (Idempotent either way.)
  const alreadyHasProfile = document.cookie.includes("jacob-has-profile=1");
  if (hasProfile && alreadyHasProfile) return;
  if (!hasProfile && !document.cookie.includes("jacob-has-profile=")) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (hasProfile) {
    document.cookie = `jacob-has-profile=1; path=/; SameSite=Lax${secure}`;
  } else {
    document.cookie = `jacob-has-profile=; path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

/**
 * One-shot fetch of the authenticated user's profile via
 * `GET /api/users/me/bootstrap`. Replaces the prior Firestore
 * `onSnapshot(users/{uid})` listener.
 *
 * The `jacob-has-profile` cookie that gates `frontend/middleware.ts` is
 * mirrored client-side from the bootstrap response. The backend also
 * sets it (works in same-origin prod), but cross-origin browsers don't
 * accept the Set-Cookie under the frontend's origin — so we write it
 * here too. See data-layer migration plan §7.M2.5 and H3 in the M6
 * review.
 *
 * `refresh()` re-fetches; callers that mutate the profile (the onboarding
 * form, settings page) call it after a successful write.
 */
export function useUser(uid: string | undefined): UseUserResult {
  const [state, setState] = useState<{
    loading: boolean;
    profile: UserProfile | null;
  }>({ loading: true, profile: null });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setState({ loading: false, profile: null });
      return;
    }

    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    setState((prev) => ({ loading: true, profile: prev.profile }));
    try {
      const res = await apiGet<BootstrapResponse>("/api/users/me/bootstrap", {
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      // 200 with hasProfile=false is a definitive "no profile" — clear
      // local state and the gate cookie so the onboarding redirect fires.
      setHasProfileCookie(res.hasProfile);
      setState({
        loading: false,
        profile: res.hasProfile && res.profile ? res.profile : null,
      });
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError) {
        if (err.code === "aborted") return;
        // Transport failures (`network_error`, `cors_blocked`) and 5xx
        // surface here. They are NOT evidence the user has no profile —
        // zeroing `profile` would race the onboarding redirect on a
        // momentary network blip. Keep the previous state and let the
        // next mount / refresh retry. Auth-level errors (401/403) still
        // clear the profile so a revoked token doesn't leave stale data.
        const transient =
          err.code === "network_error" ||
          err.code === "cors_blocked" ||
          err.status >= 500;
        console.warn("user_bootstrap_failed", err.code, err.status);
        if (transient) {
          setState((prev) => ({ loading: false, profile: prev.profile }));
          return;
        }
      }
      setState({ loading: false, profile: null });
    }
  }, [uid]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return {
    loading: state.loading,
    profile: state.profile,
    refresh: load,
  } as UseUserResult;
}
