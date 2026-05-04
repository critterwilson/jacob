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
      setHasProfileCookie(res.hasProfile);
      setState({
        loading: false,
        profile: res.hasProfile && res.profile ? res.profile : null,
      });
    } catch (err) {
      if (ctl.signal.aborted) return;
      // ApiError is the canonical shape; transport failures surface as
      // ApiError(0, "network_error", ...) and are treated identically to
      // "no profile" so the onboarding redirect still fires. The 401
      // case (token revoked / sign-out race) also lands here.
      if (err instanceof ApiError) {
        // Surfaced for diagnostics; the SPA recovers by retrying on the
        // next mount.
        if (err.code !== "aborted") {
          console.warn("user_bootstrap_failed", err.code, err.status);
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
