"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

export type RoleClaims = {
  isAdmin: boolean;
  isModerator: boolean;
  isMinistryOwner: boolean;
};

const EMPTY: RoleClaims = {
  isAdmin: false,
  isModerator: false,
  isMinistryOwner: false,
};

/**
 * Resolves the user's platform-level custom claims (`admin`, `moderator`,
 * `ministry_owner`) so nav surfaces can render role-conditional entries
 * without each call site re-implementing `getIdTokenResult`.
 *
 * Returns `null` while loading (so callers can render nothing during the
 * first paint and avoid a flash of admin links) and a `RoleClaims`
 * record once resolved.
 *
 * The ID token is **force-refreshed** on mount and again on window focus.
 * A role granted server-side (admin / moderator / ministry_owner) only
 * lands in the user's ID token on its next rotation — up to ~1h away —
 * so without a forced read a freshly-promoted user would not see their
 * role-gated UI (Admin nav, create-flow gates, …) until then or until a
 * re-login. Firebase coalesces concurrent refreshes and caches the
 * result, so a force-read on mount + focus stays cheap.
 */
export function useRoleClaims(): RoleClaims | null {
  const { user, loading } = useAuth();
  const [claims, setClaims] = useState<RoleClaims | null>(null);

  useEffect(() => {
    if (loading) return;
    // `getIdTokenResult` is missing on the mock user shape used by
    // older AppShell tests; falling back to EMPTY keeps the hook safe
    // for those tests while still resolving real claims in prod.
    if (!user || typeof user.getIdTokenResult !== "function") {
      setClaims(EMPTY);
      return;
    }
    let cancelled = false;

    const read = (forceRefresh: boolean) => {
      user
        .getIdTokenResult(forceRefresh)
        .then((result) => {
          if (cancelled) return;
          setClaims({
            isAdmin: result.claims.admin === true,
            isModerator: result.claims.moderator === true,
            isMinistryOwner: result.claims.ministry_owner === true,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setClaims(EMPTY);
        });
    };

    // Force a refresh so a just-granted role is reflected promptly, and
    // again whenever the user returns to the tab.
    read(true);
    const onFocus = () => read(true);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [user, loading]);

  return claims;
}
