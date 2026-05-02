/**
 * T20 — text moderation via Cloud Natural Language `moderateText`.
 *
 * The exported helpers are pure-ish and easy to unit-test:
 *   - thresholdsFor(policy)         : returns hide/flag cutoffs for the policy
 *   - decisionFor(scores, policy)   : returns 'hide' | 'flag' | null
 *   - circuit breaker primitives    : recordSuccess / recordFailure / isOpen
 *
 * `moderateText(text)` performs the live API call. The trigger module
 * passes a real client; tests pass a fake.
 *
 * Categories tracked (subset of Cloud NL): Toxic, Insult, Profanity,
 * Derogatory, Sexual, Violent. Other categories returned by the API
 * are dropped — they are too noisy for our use case (e.g. Politics).
 *
 * Banned categories (always hide regardless of policy):
 *   - "Sexual" — explicit content; CSAM detection still requires the
 *     image-side hash check. Text-only sexual content is hidden at the
 *     `lenient` threshold (0.95) to give leaders room while still
 *     escalating clearly explicit content.
 */

import type { protos } from "@google-cloud/language";

export type Policy = "lenient" | "standard" | "strict";

export type CategoryScore = {
  name: string;
  confidence: number;
};

export type ModerationDecision = "hide" | "flag" | null;

export const TRACKED_CATEGORIES = new Set([
  "Toxic",
  "Insult",
  "Profanity",
  "Derogatory",
  "Sexual",
  "Violent",
]);

// Categories that are *always* hidden once they exceed the strict-tier
// `hide` threshold, even on the lenient policy. The "always-hidden"
// shortcut for sexual content per the T20 spec.
const ALWAYS_HIDE_AT_STRICT = new Set(["Sexual"]);

type Thresholds = { hide: number; flag: number };

const POLICY_THRESHOLDS: Record<Policy, Thresholds> = {
  lenient: { hide: 0.95, flag: 0.85 },
  standard: { hide: 0.85, flag: 0.7 },
  strict: { hide: 0.7, flag: 0.5 },
};

export function thresholdsFor(policy: Policy): Thresholds {
  return POLICY_THRESHOLDS[policy];
}

/**
 * Pick the strongest decision across all tracked categories.
 *
 * Logic per category:
 *   - If category in ALWAYS_HIDE_AT_STRICT and confidence > strict.hide → hide
 *   - Else compare against the policy's hide threshold → hide
 *   - Else compare against the policy's flag threshold → flag
 *
 * The returned `reasons` are the categories that triggered the decision.
 */
export function decisionFor(
  scores: CategoryScore[],
  policy: Policy,
): { decision: ModerationDecision; reasons: string[] } {
  const t = thresholdsFor(policy);
  const strict = thresholdsFor("strict");

  const hideReasons: string[] = [];
  const flagReasons: string[] = [];

  for (const { name, confidence } of scores) {
    if (!TRACKED_CATEGORIES.has(name)) continue;
    if (ALWAYS_HIDE_AT_STRICT.has(name) && confidence >= strict.hide) {
      hideReasons.push(name);
      continue;
    }
    if (confidence >= t.hide) {
      hideReasons.push(name);
    } else if (confidence >= t.flag) {
      flagReasons.push(name);
    }
  }

  if (hideReasons.length > 0) return { decision: "hide", reasons: hideReasons };
  if (flagReasons.length > 0) return { decision: "flag", reasons: flagReasons };
  return { decision: null, reasons: [] };
}

// ── circuit breaker ──────────────────────────────────────────────────────────
//
// Process-local. Cloud Functions instances reuse module state across
// invocations within the same warm container, so consecutive failures
// in the same instance trip the breaker. The 5-minute open window is
// short enough that a single instance recovering (and a fresh
// container) re-tries quickly.

type BreakerState = {
  failures: number;
  openedAt: number | null;
};

const _state: BreakerState = { failures: 0, openedAt: null };

const FAILURES_TO_OPEN = 5;
const OPEN_DURATION_MS = 5 * 60 * 1000;

export function isCircuitOpen(now: number = Date.now()): boolean {
  if (_state.openedAt === null) return false;
  if (now - _state.openedAt > OPEN_DURATION_MS) {
    _state.openedAt = null;
    _state.failures = 0;
    return false;
  }
  return true;
}

export function recordSuccess(): void {
  _state.failures = 0;
  _state.openedAt = null;
}

export function recordFailure(now: number = Date.now()): void {
  _state.failures += 1;
  if (_state.failures >= FAILURES_TO_OPEN) {
    _state.openedAt = now;
  }
}

// Test-only reset.
export function _resetCircuitForTests(): void {
  _state.failures = 0;
  _state.openedAt = null;
}

// ── live API call ────────────────────────────────────────────────────────────

export interface NLClient {
  moderateText(args: {
    document: { content: string; type: protos.google.cloud.language.v2.Document.Type };
  }): Promise<[protos.google.cloud.language.v2.IModerateTextResponse, unknown, unknown]>;
}

/**
 * Call Cloud NL moderateText and return the (filtered) category scores.
 *
 * Throws on transport / API error so the caller can record a circuit
 * breaker failure. Returns an empty array if the response is empty.
 */
export async function moderateText(
  client: NLClient,
  text: string,
): Promise<CategoryScore[]> {
  const [response] = await client.moderateText({
    document: {
      content: text,
      type: 2, // PLAIN_TEXT
    },
  });

  const categories = response.moderationCategories ?? [];
  return categories
    .filter((c) => c.name)
    .map((c) => ({
      name: c.name as string,
      confidence: typeof c.confidence === "number" ? c.confidence : 0,
    }));
}
