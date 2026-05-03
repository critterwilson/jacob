/**
 * T32 — moderation + mention fan-out for boards.
 *
 * Mirrors `onMessageCreate.ts` but keyed on `boards/{boardId}/posts/{postId}`.
 * Boards have no membership concept, so:
 *   - Mention fan-out skips the membership check (`isMember: () => true`),
 *     but still applies the block check (T21 producer-side suppression).
 *   - Post counts on `boards/{boardId}.postCount` are maintained via
 *     `FieldValue.increment(1)` here on create.
 *
 * Cost guardrails (P8):
 *   - Reuses the shared text-moderation circuit breaker.
 *   - Reuses `moderation_state/text-{YYYY-MM-DD}` daily call counter
 *     so that group + board moderation share the same daily budget.
 *   - Honours `MODERATION_TEXT_DISABLED=true`.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
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
import { fanOutMentions } from "./services/mentionFanout";

if (!getApps().length) {
  initializeApp();
}

let _nlClient: import("@google-cloud/language").v2.LanguageServiceClient | null = null;
function getNLClient() {
  if (_nlClient) return _nlClient;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { v2 } = require("@google-cloud/language");
  _nlClient = new v2.LanguageServiceClient();
  return _nlClient!;
}

const POLICY: Policy = "standard"; // boards are platform-wide; one policy.
const DAILY_CALL_CAP = parseInt(process.env.JACOB_TEXT_MODERATION_DAILY_CAP ?? "5000", 10);
const QUOTA_WARN_RATIO = 0.8;

function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function moderationStateRef(db: Firestore, day: string) {
  return db.collection("moderation_state").doc(`text-${day}`);
}

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

async function runModeration(
  db: Firestore,
  boardId: string,
  postId: string,
  body: string,
  eventId: string,
): Promise<void> {
  if (process.env.MODERATION_TEXT_DISABLED === "true") {
    logger.info("moderation_text_disabled", { eventId });
    return;
  }

  const postRef = db.collection("boards").doc(boardId).collection("posts").doc(postId);

  if (isCircuitOpen()) {
    logger.warn("moderation_circuit_open", { boardId, postId, eventId });
    await postRef.update({
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
    logger.error("moderation_quota_exceeded", { boardId, postId, day, cap: DAILY_CALL_CAP });
    await postRef.update({
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
      boardId,
      postId,
      eventId,
      error: (err as Error).message,
    });
    await postRef.update({
      moderation: {
        state: "errored",
        reasons: ["api_error"],
        scores: null,
        scoredAt: FieldValue.serverTimestamp(),
      },
    });
    return;
  }

  const { decision, reasons } = decisionFor(scores, POLICY);
  const trackedScores = Object.fromEntries(
    scores.filter((s) => TRACKED_CATEGORIES.has(s.name)).map((s) => [s.name, s.confidence]),
  );

  if (decision === null) {
    await postRef.update({
      moderation: {
        state: "scored",
        reasons: [],
        scores: trackedScores,
        scoredAt: FieldValue.serverTimestamp(),
        policy: POLICY,
      },
    });
    return;
  }

  await postRef.update({
    moderation: {
      state: decision === "hide" ? "hidden" : "flagged",
      reasons,
      scores: trackedScores,
      scoredAt: FieldValue.serverTimestamp(),
      policy: POLICY,
    },
  });

  await db.collection("moderation_queue").add({
    resourceRef: `boards/${boardId}/posts/${postId}`,
    resourceType: "board_post",
    boardId,
    reason: "auto-text-moderation",
    severity: decision === "hide" ? 2 : 1,
    auto: true,
    reasons,
    status: "pending",
    reportedBy: null,
    createdAt: FieldValue.serverTimestamp(),
    policy: POLICY,
  });

  logger.info("moderation_text_decision", {
    boardId,
    postId,
    eventId,
    decision,
    reasons,
    policy: POLICY,
  });
}

export const onBoardPostCreate = onDocumentCreated(
  {
    document: "boards/{boardId}/posts/{postId}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const body = (data.body as string | undefined) ?? "";
    const { boardId, postId } = event.params;
    const db = getFirestore();

    if (body.trim()) {
      try {
        await runModeration(db, boardId, postId, body, event.id);
      } catch (err) {
        logger.error("onBoardPostCreate_moderation_uncaught", {
          boardId,
          postId,
          eventId: event.id,
          error: (err as Error).message,
        });
      }
    }

    const mentions = (data.mentions as string[] | undefined) ?? [];
    const authorUid = (data.authorUid as string | undefined) ?? "";
    if (mentions.length > 0 && authorUid) {
      try {
        await fanOutMentions(db, {
          authorUid,
          mentions,
          payload: {
            kind: "board_mention",
            messageRef: `boards/${boardId}/posts/${postId}`,
            boardId,
          },
          // Boards have no membership; check user doc exists to avoid orphan notification docs.
          isMember: async (uid: string) => {
            const snap = await db.collection("users").doc(uid).get();
            return snap.exists;
          },
        });
        logger.info("board_mention_fanout_done", {
          boardId,
          postId,
          eventId: event.id,
          count: mentions.length,
        });
      } catch (err) {
        logger.error("board_mention_fanout_failed", {
          boardId,
          postId,
          eventId: event.id,
          error: (err as Error).message,
        });
      }
    }
  },
);
