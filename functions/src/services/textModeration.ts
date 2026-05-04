/**
 * T20 — text moderation via Cloud Natural Language `moderateText`.
 *
 * Pure helpers (easy to unit-test):
 *   - thresholdsFor(policy)         : returns hide/flag cutoffs for the policy
 *   - decisionFor(scores, policy)   : returns 'hide' | 'flag' | null
 *   - circuit breaker primitives    : recordSuccess / recordFailure / isOpen
 *
 * Live-API helper:
 *   - moderateText(client, text)    : calls Cloud NL and filters scores.
 *
 * Trigger-shared orchestration:
 *   - runTextModeration({...})      : the full per-resource flow used by
 *     both `onMessageCreate` (groups/{gid}/messages/{mid}) and
 *     `onBoardPostCreate` (boards/{boardId}/posts/{postId}). Handles the
 *     kill switch, circuit breaker, daily-call quota, API call,
 *     decision write to the resource doc, and `moderation_queue` row.
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
 *
 * Cost guardrails:
 *   - Process-local circuit breaker (5 errors → open 5 min).
 *   - Daily-call cap stored at `moderation_state/text-{YYYY-MM-DD}` —
 *     when reached, the trigger no-ops with `moderation_quota_exceeded`.
 *   - Sentry alert at 80% of the cap (a `moderation_quota_warning` log
 *     line that the alert policy in `infra/uptime-checks.tf` matches on).
 *
 * Kill switch: `MODERATION_TEXT_DISABLED=true` makes moderation a no-op
 * without redeploying.
 */

import type { protos } from "@google-cloud/language";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

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

// ── per-resource orchestration ───────────────────────────────────────────────
//
// Shared by onMessageCreate (groups/{gid}/messages/{mid}) and
// onBoardPostCreate (boards/{boardId}/posts/{postId}). Behaviour is
// identical to the previous duplicated implementations.

const DAILY_CALL_CAP_DEFAULT = 5000;
const QUOTA_WARN_RATIO = 0.8;

function dailyCallCap(): number {
  return parseInt(
    process.env.JACOB_TEXT_MODERATION_DAILY_CAP ?? String(DAILY_CALL_CAP_DEFAULT),
    10,
  );
}

export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function moderationStateRef(db: Firestore, day: string) {
  return db.collection("moderation_state").doc(`text-${day}`);
}

function moderationEventMarkerRef(db: Firestore, eventId: string) {
  return db.collection("moderation_text_events").doc(eventId);
}

/**
 * Reserve one slot of the daily text-moderation quota, idempotent on
 * `eventId`. Cloud Function v2 Firestore triggers are at-least-once;
 * without an event-level dedupe a container crash between the quota
 * debit and the result write would burn another slot on retry. Closes
 * PR11 / M3.
 *
 * Returns:
 *   - { ok: true, count: N }  — slot reserved, this is delivery #1.
 *   - { ok: false, alreadyProcessed: true }  — eventId was processed
 *     before; caller must skip the moderation flow entirely.
 *   - { ok: false, capExceeded: true }  — daily cap hit; caller writes
 *     a `quota_exceeded` skip on the resource.
 */
export type QuotaReservation =
  | { ok: true; count: number }
  | { ok: false; alreadyProcessed: true }
  | { ok: false; capExceeded: true };

export async function tryReserveQuota(
  db: Firestore,
  day: string,
  eventId: string,
): Promise<QuotaReservation> {
  const cap = dailyCallCap();
  const stateRef = moderationStateRef(db, day);
  const markerRef = moderationEventMarkerRef(db, eventId);
  return await db.runTransaction(async (txn) => {
    const markerSnap = await txn.get(markerRef);
    if (markerSnap.exists) {
      return { ok: false, alreadyProcessed: true };
    }
    const stateSnap = await txn.get(stateRef);
    const current = (stateSnap.exists ? (stateSnap.data()?.count ?? 0) : 0) as number;
    if (current >= cap) {
      // Don't write the marker here — a future delivery still has a
      // chance to claim the slot if cap rolls over (next day) before
      // re-delivery. Caller writes a `quota_exceeded` skip regardless.
      return { ok: false, capExceeded: true };
    }
    // Marker + quota debit in the same transaction — atomic, so a crash
    // either commits both or neither.
    txn.set(markerRef, {
      processedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      day,
      kind: "text_moderation_quota",
    });
    txn.set(
      stateRef,
      {
        count: FieldValue.increment(1),
        day,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, count: current + 1 };
  });
}

export type ResourceType = "message" | "board_post";

export type RunTextModerationParams = {
  db: Firestore;
  /** The Firestore doc that gets the `moderation` field written to it. */
  resourceDocRef: DocumentReference;
  /** Canonical path string written into `moderation_queue.resourceRef`. */
  resourcePath: string;
  resourceType: ResourceType;
  /**
   * Extra FK fields merged into the moderation_queue row (e.g. `{ groupId }`
   * for messages, `{ boardId }` for board posts).
   */
  resourceFkFields: Record<string, string>;
  eventId: string;
  body: string;
  /** Pre-resolved policy. Boards use a constant; messages read per-group. */
  policy: Policy;
  /**
   * When provided, the moderation_queue row is written to a deterministic
   * doc id `${queueDocIdPrefix}_${eventId}` (idempotent on retried events).
   * When omitted, the row is `add()`-ed with an auto id.
   */
  queueDocIdPrefix?: string;
  /** Lazy NL client provider — kept per-trigger to preserve existing init. */
  getNLClient: () => NLClient;
  /** Extra fields included on every log line for this resource. */
  logContext: Record<string, unknown>;
};

export async function runTextModeration(
  params: RunTextModerationParams,
): Promise<void> {
  const {
    db,
    resourceDocRef,
    resourcePath,
    resourceType,
    resourceFkFields,
    eventId,
    body,
    policy,
    queueDocIdPrefix,
    getNLClient,
    logContext,
  } = params;

  if (process.env.MODERATION_TEXT_DISABLED === "true") {
    logger.info("moderation_text_disabled", { eventId });
    return;
  }

  if (isCircuitOpen()) {
    logger.warn("moderation_circuit_open", { ...logContext, eventId });
    await resourceDocRef.update({
      moderation: {
        state: "skipped",
        reasons: ["circuit_open"],
        scores: null,
        scoredAt: FieldValue.serverTimestamp(),
      },
    });
    return;
  }

  const day = todayKey();
  const cap = dailyCallCap();
  const reservation = await tryReserveQuota(db, day, eventId);
  if (!reservation.ok && "alreadyProcessed" in reservation) {
    // PR11 / M3 — re-delivery of an event we've already processed.
    // Skip the quota debit AND the API call — both already happened on
    // delivery #1, and the resource doc was either updated or the
    // function crashed in a window the marker can no longer reopen.
    logger.info("moderation_text_event_already_processed", { ...logContext, eventId, day });
    return;
  }
  if (!reservation.ok && "capExceeded" in reservation) {
    logger.error("moderation_quota_exceeded", { ...logContext, day, cap });
    await resourceDocRef.update({
      moderation: {
        state: "skipped",
        reasons: ["quota_exceeded"],
        scores: null,
        scoredAt: FieldValue.serverTimestamp(),
      },
    });
    return;
  }
  const newCount = reservation.ok ? reservation.count : 0;
  if (newCount === Math.floor(cap * QUOTA_WARN_RATIO)) {
    logger.warn("moderation_quota_warning", {
      day,
      count: newCount,
      cap,
      threshold: QUOTA_WARN_RATIO,
    });
  }

  let scores: CategoryScore[] = [];
  try {
    scores = await moderateText(getNLClient(), body);
    recordSuccess();
  } catch (err) {
    recordFailure();
    logger.error("moderation_text_api_failed", {
      ...logContext,
      eventId,
      error: (err as Error).message,
    });
    await resourceDocRef.update({
      moderation: {
        state: "errored",
        reasons: ["api_error"],
        scores: null,
        scoredAt: FieldValue.serverTimestamp(),
      },
    });
    return;
  }

  const { decision, reasons } = decisionFor(scores, policy);
  const trackedScores = Object.fromEntries(
    scores
      .filter((s) => TRACKED_CATEGORIES.has(s.name))
      .map((s) => [s.name, s.confidence]),
  );

  if (decision === null) {
    await resourceDocRef.update({
      moderation: {
        state: "scored",
        reasons: [],
        scores: trackedScores,
        scoredAt: FieldValue.serverTimestamp(),
        policy,
      },
    });
    return;
  }

  await resourceDocRef.update({
    moderation: {
      state: decision === "hide" ? "hidden" : "flagged",
      reasons,
      scores: trackedScores,
      scoredAt: FieldValue.serverTimestamp(),
      policy,
    },
  });

  const severity = decision === "hide" ? 2 : 1;
  const queueDoc = {
    resourceRef: resourcePath,
    resourceType,
    ...resourceFkFields,
    reason: "auto-text-moderation",
    severity,
    auto: true,
    reasons,
    status: "pending",
    reportedBy: null,
    createdAt: FieldValue.serverTimestamp(),
    policy,
  };
  const queueCollection = db.collection("moderation_queue");
  if (queueDocIdPrefix) {
    await queueCollection.doc(`${queueDocIdPrefix}_${eventId}`).set(queueDoc);
  } else {
    await queueCollection.add(queueDoc);
  }

  logger.info("moderation_text_decision", {
    ...logContext,
    eventId,
    decision,
    reasons,
    policy,
    severity,
  });
}
