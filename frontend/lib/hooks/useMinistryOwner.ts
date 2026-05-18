"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

/**
 * Resolves the `ministry_owner` Firebase custom claim for the signed-in
 * user. Returns `null` while loading (so compose UI can render
 * skeleton/nothing) and `true` / `false` once resolved. Refreshes on the
 * current user changing.
 *
 * Mirrors the admin claim check in `frontend/app/admin/layout.tsx`.
 */
export function useMinistryOwner(): boolean | null {
  const { user, loading } = useAuth();
  const [isOwner, setIsOwner] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setIsOwner(false);
      return;
    }
    let cancelled = false;
    user
      .getIdTokenResult()
      .then((result) => {
        if (cancelled) return;
        setIsOwner(result.claims.ministry_owner === true);
      })
      .catch(() => {
        if (cancelled) return;
        setIsOwner(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return isOwner;
}
