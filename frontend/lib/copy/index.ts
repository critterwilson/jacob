// T56 — audience-keyed copy lookup.
//
// `useCopy("some.key")` returns the copy for the workspace org's
// audience. The app targets Christian ministries only; the christian
// table is the single source of copy. The `audience` enum is retained
// in the data model to distinguish Christian-flavored groups from
// audience-neutral "general" ones, but every audience resolves to the
// christian copy. Untranslated keys return the key itself (so
// missing-string regressions are visually obvious in dev).

"use client";

import { useWorkspaceOrg } from "@/lib/org-context";

import { christianCopy } from "./christian";
import type { Audience, CopyMap } from "./types";

const VARIANTS: Record<Audience, CopyMap> = {
  christian: christianCopy,
  general: christianCopy,
};

export function getCopy(audience: Audience, key: string): string {
  const variant = VARIANTS[audience] ?? christianCopy;
  if (key in variant) return variant[key];
  if (key in christianCopy) return christianCopy[key];
  // Surfacing the raw key in dev makes missing strings caught at glance
  // rather than via translator review.
  return key;
}

export function useCopy(key: string): string {
  const org = useWorkspaceOrg();
  const audience: Audience = org?.audience ?? "christian";
  return getCopy(audience, key);
}

export type { Audience, CopyMap } from "./types";
