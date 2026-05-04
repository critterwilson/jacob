/**
 * T20 — automated text moderation.
 * T27 — @mention notification fan-out.
 * T56 — sticker-audience mismatch flag.
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
 *
 * T56 Sticker-audience guard:
 *   Defense-in-depth — the picker filters by group audience client-side,
 *   but a determined caller could POST any sticker slug. If the message
 *   carries a sticker whose `audience` is neither the group's audience
 *   nor `general`, we set `moderation.state = "flagged"` with reason
 *   `audience_mismatch` and write a moderation_queue row. The message
 *   is NOT auto-hidden (matches the policy from T20: trigger surfaces,
 *   human reviews).
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
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

/**
 * T56 — flag a message whose sticker audience doesn't match the parent
 * group's audience (and isn't `general`). Idempotent via an event marker
 * mirror to onMessageWrite. Best-effort — never throws.
 */
export async function flagAudienceMismatch(
  db: Firestore,
  gid: string,
  mid: string,
  stickerIds: string[],
  eventId: string,
): Promise<void> {
  if (stickerIds.length === 0) return;

  const groupSnap = await db.collection("groups").doc(gid).get();
  if (!groupSnap.exists) return;
  const groupAudience =
    (groupSnap.data() as { audience?: string } | undefined)?.audience ??
    "christian";

  const offenders: { slug: string; audience: string }[] = [];
  for (const slug of stickerIds) {
    const stickerSnap = await db.collection("stickers").doc(slug).get();
    if (!stickerSnap.exists) continue;
    const stickerAudience =
      (stickerSnap.data() as { audience?: string } | undefined)?.audience ??
      "christian";
    if (stickerAudience === "general") continue;
    if (stickerAudience !== groupAudience) {
      offenders.push({ slug, audience: stickerAudience });
    }
  }
  if (offenders.length === 0) return;

  const messageRef = db
    .collection("groups")
    .doc(gid)
    .collection("messages")
    .doc(mid);
  const queueId = `audience_${gid}_${mid}_${eventId}`;

  // Defense-in-depth: don't auto-hide. The reviewer decides.
  await messageRef.set(
    {
      moderation: {
        state: "flagged",
        reason: "audience_mismatch",
        offendingStickers: offenders.map((o) => o.slug),
        flaggedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
  await db.collection("moderation_queue").doc(queueId).set(
    {
      resourceRef: `groups/${gid}/messages/${mid}`,
      resourceType: "message",
      groupId: gid,
      reason: "audience_mismatch",
      severity: 1,
      auto: true,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      offendingStickers: offenders,
    },
    { merge: false },
  );
  logger.info("audience_mismatch_flagged", {
    gid,
    mid,
    eventId,
    offenders: offenders.map((o) => o.slug),
  });
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

    // T56 — sticker-audience guard (best-effort, never throws)
    const stickerIds = (data.stickerIds as string[] | undefined) ?? [];
    if (stickerIds.length > 0) {
      try {
        await flagAudienceMismatch(db, gid, mid, stickerIds, event.id);
      } catch (err) {
        logger.error("audience_mismatch_check_failed", {
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
