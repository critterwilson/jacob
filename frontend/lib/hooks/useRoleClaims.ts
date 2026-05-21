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
    user
      .getIdTokenResult()
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
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return claims;
}
