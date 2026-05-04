/**
 * T20 — automated text moderation.
 * T27 — @mention notification fan-out.
 *
 * Fires on `groups/{gid}/messages/{mid}` create events.
 *
 * T20 Moderation:
 *   Reads the group's moderationPolicy (default "standard"), then delegates
 *   to the shared `runTextModeration` helper which calls Cloud NL
 *   `moderateText` and writes the resource + moderation_queue updates.
 *   See `services/textModeration.ts` for the full flow and cost guardrails.
 *
 * T27 Mention fan-out:
 *   Reads `mentions` (uid[]) from the message doc and writes one
 *   `users/{uid}/notifications/{nid}` row per mentioned user
 *   (kind: "mention"). Skips self, skips users who blocked the author,
 *   skips non-members.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

import { type Policy, runTextModeration } from "./services/textModeration";
import { fanOutMentions } from "./services/mentionFanout";

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

async function readPolicy(db: Firestore, gid: string): Promise<Policy> {
  const groupSnap = await db.collection("groups").doc(gid).get();
  if (!groupSnap.exists) return DEFAULT_POLICY;
  const raw = groupSnap.data()?.moderationPolicy as string | undefined;
  if (raw === "lenient" || raw === "standard" || raw === "strict") return raw;
  return DEFAULT_POLICY;
}

export async function fanOutMentionNotifications(
  db: Firestore,
  gid: string,
  mid: string,
  authorUid: string,
  mentions: string[],
): Promise<void> {
  await fanOutMentions(db, {
    authorUid,
    mentions,
    payload: {
      kind: "mention",
      messageRef: `groups/${gid}/messages/${mid}`,
      groupId: gid,
    },
    isMember: async (uid) => {
      const snap = await db
        .collection("groups")
        .doc(gid)
        .collection("members")
        .doc(uid)
        .get();
      return snap.exists;
    },
  });
}

export const onMessageCreate = onDocumentCreated(
  {
    document: "groups/{gid}/messages/{mid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const body = (data.body as string | undefined) ?? "";
    const { gid, mid } = event.params;
    const db = getFirestore();

    // Moderation (non-fatal: failures are logged; fan-out always runs)
    if (body.trim()) {
      try {
        const policy = await readPolicy(db, gid);
        await runTextModeration({
          db,
          resourceDocRef: db
            .collection("groups")
            .doc(gid)
            .collection("messages")
            .doc(mid),
          resourcePath: `groups/${gid}/messages/${mid}`,
          resourceType: "message",
          resourceFkFields: { groupId: gid },
          eventId: event.id,
          body,
          policy,
          queueDocIdPrefix: "msg",
          getNLClient: () => getNLClient() as never,
          logContext: { gid, mid },
        });
      } catch (err) {
        logger.error("onMessageCreate_moderation_uncaught", {
          gid,
          mid,
          eventId: event.id,
          error: (err as Error).message,
        });
      }
    }

    // T27 — mention fan-out (runs regardless of moderation outcome)
    const mentions = (data.mentions as string[] | undefined) ?? [];
    const authorUid = (data.authorUid as string | undefined) ?? "";
    if (mentions.length > 0 && authorUid) {
      try {
        await fanOutMentionNotifications(db, gid, mid, authorUid, mentions);
        logger.info("mention_fanout_done", {
          gid,
          mid,
          eventId: event.id,
          count: mentions.length,
        });
      } catch (err) {
        logger.error("mention_fanout_failed", {
          gid,
          mid,
          eventId: event.id,
          error: (err as Error).message,
        });
      }
    }
  },
);
