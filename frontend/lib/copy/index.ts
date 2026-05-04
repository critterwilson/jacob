// T56 — audience-keyed copy lookup.
//
// `useCopy("some.key")` returns the right variant for the workspace
// org's audience (christian by default, bjj for BJJ orgs, general
// behaves as christian until / unless we ship a third copy table).
//
// Christian is the canonical/fallback variant. BJJ overrides only the
// keys where the christian wording would be jarring — anything else
// falls through to christian. Untranslated keys return the key itself
// (so missing-string regressions are visually obvious in dev).

"use client";

import { useWorkspaceOrg } from "@/lib/org-context";

import { bjjCopy } from "./bjj";
import { christianCopy } from "./christian";
import type { Audience, CopyMap } from "./types";

const VARIANTS: Record<Audience, CopyMap> = {
  christian: christianCopy,
  bjj: bjjCopy,
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
