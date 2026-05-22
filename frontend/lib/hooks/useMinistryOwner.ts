"use client";

import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

/**
 * Resolves the `ministry_owner` Firebase custom claim for the signed-in
 * user. Returns `null` while loading (so compose UI can render
 * skeleton/nothing) and `true` / `false` once resolved.
 *
 * Thin wrapper over `useRoleClaims` so the token-refresh behaviour
 * (force-refresh on mount and on window focus) is shared — a freshly
 * granted `ministry_owner` role is reflected without a re-login.
 */
export function useMinistryOwner(): boolean | null {
  const claims = useRoleClaims();
  return claims === null ? null : claims.isMinistryOwner;
}
