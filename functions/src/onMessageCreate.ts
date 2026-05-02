/**
 * T20 — automated text moderation.
 *
 * Fires on `groups/{gid}/messages/{mid}` create events. Reads the
 * group's moderationPolicy (default "standard"), calls Cloud NL
 * `moderateText`, and:
 *   - Sets `messages/{mid}.moderation` with `state: "hidden"` if any
 *     tracked category exceeds the policy's hide threshold; also writes
 *     a `moderation_queue` row with `auto: true` severity 2.
 *   - Writes a `moderation_queue` row with `auto: true` severity 1 if
 *     the message exceeds the flag-only threshold.
 *
 * Cost guardrails:
 *   - Process-local circuit breaker (5 errors → open 5 min) avoids a
 *     runaway-loop scenario where every message hits the API.
 *   - Daily-call cap stored at `moderation_state/text-{YYYY-MM-DD}` —
 *     when reached, the trigger no-ops with `moderation_quota_exceeded`.
 *   - Sentry alert at 80% of the cap (a `moderation_quota_warning` log
 *     line that the alert policy in `infra/uptime-checks.tf` matches on).
 *
 * Kill switch: `MODERATION_TEXT_DISABLED=true` makes the trigger a
 * no-op without redeploying.
 *
 * Edits / soft-deletes do not re-score (T20 explicitly defers re-scoring
 * to a Phase 3 task; an edit just clears `moderation` server-side via a
 * future admin tool).
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore, Firestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import {
  decisionFor,
  isCircuitOpen,
  moderateText,
  type Policy,
  recordFailure,
  recordSuccess,
  TRACKED_CATEGORIES,
  type CategoryScore,
} from "./services/textModeration";

if (!getApps().length) {
  initializeApp();
}

// Lazy-init the NL client so module load does not hit network in tests.
let _nlClient: import("@google-cloud/language").v2.LanguageServiceClient | null = null;
function getNLClient() {
  if (_nlClient) return _nlClient;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { v2 } = require("@google-cloud/language");
  _nlClient = new v2.LanguageServiceClient();
  return _nlClient!;
}

const DEFAULT_POLICY: Policy = "standard";
const DAILY_CALL_CAP = parseInt(process.env.JACOB_TEXT_MODERATION_DAILY_CAP ?? "5000", 10);
const QUOTA_WARN_RATIO = 0.8;

function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function moderationStateRef(db: Firestore, day: string) {
  return db.collection("moderation_state").doc(`text-${day}`);
}

/**
 * Atomically increment the daily counter and return the new value.
 * Returns null when the cap has already been reached.
 */
async function tryReserveQuota(db: Firestore, day: string): Promise<number | null> {
  const ref = moderationStateRef(db, day);
  return await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const current = (snap.exists ? snap.data()?.count ?? 0 : 0) as number;
    if (current >= DAILY_CALL_CAP) {
      return null;
    }
    txn.set(
      ref,
      {
        count: FieldValue.increment(1),
        day,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return current + 1;
  });
}

async function readPolicy(db: Firestore, gid: string): Promise<Policy> {
  const groupSnap = await db.collection("groups").doc(gid).get();
  if (!groupSnap.exists) return DEFAULT_POLICY;
  const raw = groupSnap.data()?.moderationPolicy as string | undefined;
  if (raw === "lenient" || raw === "standard" || raw === "strict") return raw;
  return DEFAULT_POLICY;
}

export const onMessageCreate = onDocumentCreated(
  {
    document: "groups/{gid}/messages/{mid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    if (process.env.MODERATION_TEXT_DISABLED === "true") {
      logger.info("moderation_text_disabled", { eventId: event.id });
      return;
    }

    const data = event.data?.data();
    if (!data) return;

    const body = (data.body as string | undefined) ?? "";
    if (!body.trim()) return;

    // Skip thread replies — moderate the parent path only? Actually the
    // spec says onMessageCreate runs on every new message including
    // replies. Replies share the same risk surface.
    const { gid, mid } = event.params;
    const db = getFirestore();
    const messageRef = db.collection("groups").doc(gid).collection("messages").doc(mid);

    if (isCircuitOpen()) {
      logger.warn("moderation_circuit_open", { gid, mid, eventId: event.id });
      await messageRef.update({
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
    const newCount = await tryReserveQuota(db, day);
    if (newCount === null) {
      logger.error("moderation_quota_exceeded", { gid, mid, day, cap: DAILY_CALL_CAP });
      await messageRef.update({
        moderation: {
          state: "skipped",
          reasons: ["quota_exceeded"],
          scores: null,
          scoredAt: FieldValue.serverTimestamp(),
        },
      });
      return;
    }
    if (newCount === Math.floor(DAILY_CALL_CAP * QUOTA_WARN_RATIO)) {
      logger.warn("moderation_quota_warning", {
        day,
        count: newCount,
        cap: DAILY_CALL_CAP,
        threshold: QUOTA_WARN_RATIO,
      });
    }

    let scores: CategoryScore[] = [];
    try {
      scores = await moderateText(getNLClient() as never, body);
      recordSuccess();
    } catch (err) {
      recordFailure();
      logger.error("moderation_text_api_failed", {
        gid,
        mid,
        eventId: event.id,
        error: (err as Error).message,
      });
      await messageRef.update({
        moderation: {
          state: "errored",
          reasons: ["api_error"],
          scores: null,
          scoredAt: FieldValue.serverTimestamp(),
        },
      });
      return;
    }

    const policy = await readPolicy(db, gid);
    const { decision, reasons } = decisionFor(scores, policy);

    // Always persist the score snapshot for audit / triage, even when
    // there is no decision. Limit `scores` to tracked categories so the
    // doc doesn't bloat.
    const trackedScores = Object.fromEntries(
      scores.filter((s) => TRACKED_CATEGORIES.has(s.name)).map((s) => [s.name, s.confidence]),
    );

    if (decision === null) {
      await messageRef.update({
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

    if (decision === "hide") {
      await messageRef.update({
        moderation: {
          state: "hidden",
          reasons,
          scores: trackedScores,
          scoredAt: FieldValue.serverTimestamp(),
          policy,
        },
      });
    } else {
      await messageRef.update({
        moderation: {
          state: "flagged",
          reasons,
          scores: trackedScores,
          scoredAt: FieldValue.serverTimestamp(),
          policy,
        },
      });
    }

    // Write into the moderation queue. Severity 2 for hide, 1 for flag.
    const severity = decision === "hide" ? 2 : 1;
    await db.collection("moderation_queue").add({
      resourceRef: `groups/${gid}/messages/${mid}`,
      resourceType: "message",
      groupId: gid,
      reason: "auto-text-moderation",
      severity,
      auto: true,
      reasons,
      status: "pending",
      reportedBy: null,
      createdAt: FieldValue.serverTimestamp(),
      policy,
    });

    logger.info("moderation_text_decision", {
      gid,
      mid,
      eventId: event.id,
      decision,
      reasons,
      policy,
      severity,
    });
  },
);
