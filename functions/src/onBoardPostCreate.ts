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
 *
 * Moderation orchestration is shared with onMessageCreate via
 * `services/textModeration.ts`'s `runTextModeration` helper.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { type Policy, runTextModeration } from "./services/textModeration";
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
        await runTextModeration({
          db,
          resourceDocRef: db
            .collection("boards")
            .doc(boardId)
            .collection("posts")
            .doc(postId),
          resourcePath: `boards/${boardId}/posts/${postId}`,
          resourceType: "board_post",
          resourceFkFields: { boardId },
          eventId: event.id,
          body,
          policy: POLICY,
          // Boards intentionally use auto-id queue rows (pre-extraction
          // behaviour); no queueDocIdPrefix.
          getNLClient: () => getNLClient() as never,
          logContext: { boardId, postId },
        });
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
