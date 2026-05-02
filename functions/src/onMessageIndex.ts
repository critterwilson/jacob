/**
 * T28 — keep the Typesense `messages` index in sync with Firestore.
 *
 * Trigger: `groups/{gid}/messages/{mid}` (any write).
 *
 * Logic:
 *   - Soft-deleted (after.deletedAt != null) → delete from Typesense.
 *   - Hard-deleted (!after.exists) → delete from Typesense.
 *   - Otherwise → upsert with normalised fields. `authorDisplayName` is
 *     resolved from `users/{authorUid}` and denormalised into the index
 *     (acceptable per ADR 0005 — search results link out to the live
 *     message which renders the live name).
 *   - Update guard `shouldReindex` skips events that don't touch any
 *     indexed field, so reaction-count and thread-reply-count tickers
 *     don't churn the index.
 *
 * Idempotency:
 *   Per-event marker at `groups/{gid}/messages/{mid}/_index_events/{eventId}`
 *   following Pattern P3.
 *
 * Cost guardrails (Pattern P8):
 *   - Process-local circuit breaker (5 errors → open 5 min).
 *   - Daily quota at `search_state/index-{YYYY-MM-DD}` (cap
 *     JACOB_SEARCH_INDEX_DAILY_CAP, default 50_000) with a Sentry-matched
 *     `search_index_quota_warning` log line at 80%.
 *   - Kill switch: `TYPESENSE_DISABLED=true` makes the trigger a no-op.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import {
  TypesenseClient,
  type IndexedMessage,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "./services/typesense";

if (!getApps().length) {
  initializeApp();
}

// ── pure helpers (unit-testable without Firestore / Typesense) ───────────────

export type MessageDoc = {
  authorUid?: unknown;
  body?: unknown;
  stickerIds?: unknown;
  parentMessageId?: unknown;
  mediaRefs?: unknown;
  editedAt?: unknown;
  deletedAt?: unknown;
  moderation?: { state?: unknown } | null;
  createdAt?: { toMillis?: () => number } | null;
} & Record<string, unknown>;

/**
 * Returns true when the change touches at least one indexed field.
 * Used to skip the upsert for unrelated denormalisations
 * (reactionCounts, threadReplyCount, participants).
 *
 * On create or hard-delete the answer is always true.
 */
export function shouldReindex(
  before: MessageDoc | undefined,
  after: MessageDoc | undefined,
): boolean {
  if (!before && after) return true; // create
  if (before && !after) return true; // hard-delete
  if (!before || !after) return false;

  const fields: (keyof MessageDoc)[] = [
    "body",
    "mediaRefs",
    "editedAt",
    "deletedAt",
    "stickerIds",
    "parentMessageId",
    "authorUid",
  ];
  for (const f of fields) {
    if (JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)) {
      return true;
    }
  }
  // moderation.state is nested; compare just that field
  const beforeState = (before.moderation ?? null)?.state ?? null;
  const afterState = (after.moderation ?? null)?.state ?? null;
  return beforeState !== afterState;
}

export type IndexAction = "upsert" | "delete" | "skip";

export function classifyIndexAction(
  beforeExists: boolean,
  afterExists: boolean,
  afterDeletedAt: unknown,
): IndexAction {
  if (!afterExists) return "delete"; // hard-delete (defensive)
  if (afterDeletedAt != null) return "delete"; // soft-delete
  if (!beforeExists || afterExists) return "upsert";
  return "skip";
}

export function buildIndexedMessage(
  id: string,
  gid: string,
  data: MessageDoc,
  authorDisplayName: string | null,
): IndexedMessage {
  const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : 0;
  const stickerIds = Array.isArray(data.stickerIds) ? (data.stickerIds as string[]) : [];
  const moderationState = (data.moderation ?? null)?.state as string | undefined;
  return {
    id,
    groupId: gid,
    authorUid: String(data.authorUid ?? ""),
    authorDisplayName: authorDisplayName ?? null,
    body: typeof data.body === "string" ? data.body : "",
    stickerIds: stickerIds.length > 0 ? stickerIds : undefined,
    createdAtUnix: Math.floor(createdAtMs / 1000),
    parentMessageId:
      typeof data.parentMessageId === "string" ? data.parentMessageId : null,
    moderationState: moderationState ?? null,
  };
}

// ── client + quota helpers ───────────────────────────────────────────────────

const DAILY_CAP = parseInt(
  process.env.JACOB_SEARCH_INDEX_DAILY_CAP ?? "50000",
  10,
);
const QUOTA_WARN_RATIO = 0.8;

function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function indexStateRef(db: Firestore, day: string) {
  return db.collection("search_state").doc(`index-${day}`);
}

export async function tryReserveIndexQuota(
  db: Firestore,
  day: string,
  cap: number = DAILY_CAP,
): Promise<number | null> {
  const ref = indexStateRef(db, day);
  return await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const current = (snap.exists ? snap.data()?.count ?? 0 : 0) as number;
    if (current >= cap) return null;
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

let _client: TypesenseClient | null = null;
function getTypesense(): TypesenseClient {
  if (_client) return _client;
  const host = process.env.TYPESENSE_HOST ?? "";
  const apiKey = process.env.TYPESENSE_ADMIN_KEY ?? "";
  const collection = process.env.TYPESENSE_COLLECTION ?? "messages";
  _client = new TypesenseClient({ host, apiKey, collection });
  return _client;
}

// Test-only reset for the cached client + quota cap.
export function _resetClientForTests(): void {
  _client = null;
}

// ── trigger ──────────────────────────────────────────────────────────────────

export const onMessageIndex = onDocumentWritten(
  {
    document: "groups/{gid}/messages/{mid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    if (process.env.TYPESENSE_DISABLED === "true") {
      logger.info("search_index_disabled", { eventId: event.id });
      return;
    }

    const before = event.data?.before;
    const after = event.data?.after;
    const beforeData = before?.data() as MessageDoc | undefined;
    const afterData = after?.data() as MessageDoc | undefined;

    if (!shouldReindex(beforeData, afterData)) return;

    const { gid, mid } = event.params;
    const db = getFirestore();

    // Idempotency guard.
    const eventRef = db
      .collection("groups")
      .doc(gid)
      .collection("messages")
      .doc(mid)
      .collection("_index_events")
      .doc(event.id);

    const wasFresh = await db.runTransaction(async (txn) => {
      const snap = await txn.get(eventRef);
      if (snap.exists) return false;
      txn.set(eventRef, { processedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!wasFresh) {
      logger.info("search_index_duplicate_event", { eventId: event.id, gid, mid });
      return;
    }

    if (isCircuitOpen()) {
      logger.warn("search_index_circuit_open", { gid, mid, eventId: event.id });
      return;
    }

    const action = classifyIndexAction(
      Boolean(before?.exists),
      Boolean(after?.exists),
      afterData?.deletedAt ?? null,
    );

    try {
      const client = getTypesense();
      if (action === "delete") {
        await client.deleteById(mid);
        recordSuccess();
        logger.info("search_index_deleted", { gid, mid, eventId: event.id });
        return;
      }
      if (action === "skip") return;

      // Quota — only spent on writes, not deletes (delete cleanup must
      // always succeed regardless of cap).
      const day = todayKey();
      const newCount = await tryReserveIndexQuota(db, day);
      if (newCount === null) {
        logger.error("search_index_quota_exceeded", {
          gid,
          mid,
          day,
          cap: DAILY_CAP,
        });
        return;
      }
      if (newCount === Math.floor(DAILY_CAP * QUOTA_WARN_RATIO)) {
        logger.warn("search_index_quota_warning", {
          day,
          count: newCount,
          cap: DAILY_CAP,
          threshold: QUOTA_WARN_RATIO,
        });
      }

      // Resolve authorDisplayName best-effort.
      let authorDisplayName: string | null = null;
      const authorUid = afterData?.authorUid as string | undefined;
      if (authorUid) {
        try {
          const userSnap = await db.collection("users").doc(authorUid).get();
          authorDisplayName =
            (userSnap.exists ? (userSnap.data()?.displayName as string) : null) ?? null;
        } catch (err) {
          logger.warn("search_index_user_lookup_failed", {
            gid,
            mid,
            authorUid,
            error: (err as Error).message,
          });
        }
      }

      const doc = buildIndexedMessage(mid, gid, afterData!, authorDisplayName);
      await client.upsert(doc);
      recordSuccess();
      logger.info("search_index_upserted", { gid, mid, eventId: event.id });
    } catch (err) {
      recordFailure();
      logger.error("search_index_failed", {
        gid,
        mid,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
