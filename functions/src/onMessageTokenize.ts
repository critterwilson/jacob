/**
 * Maintain `searchTokens` on each message for native Firestore search
 * (ADR 0016).
 *
 * Trigger: `groups/{gid}/messages/{mid}` (any write).
 *
 * Logic:
 *   - Compute the expected token set from the message body.
 *   - If the stored `searchTokens` already matches, do nothing.
 *     (This is what keeps the trigger from infinitely re-firing on
 *     its own writes.)
 *   - Otherwise write `searchTokens` back to the doc.
 *
 * Idempotent and self-stable: a re-delivery sees the tokens already
 * up to date and returns without writing.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";

if (!getApps().length) {
  initializeApp();
}

const TOKEN_RE = /[a-z0-9]+/g;
const MAX_TOKENS = 100;

export type MessageDoc = {
  body?: unknown;
  searchTokens?: unknown;
  deletedAt?: unknown;
} & Record<string, unknown>;

/**
 * Lowercase + word-split + dedupe. Capped at MAX_TOKENS so an absurdly
 * long paste can't blow past Firestore's 20k-entry array limit or the
 * 1MiB doc-size cap.
 */
export function tokenize(body: unknown): string[] {
  if (typeof body !== "string" || body.length === 0) return [];
  const matches = body.toLowerCase().match(TOKEN_RE);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of matches) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

export function tokensEqual(a: string[], b: unknown): boolean {
  if (!Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const onMessageTokenize = onDocumentWritten(
  {
    document: "groups/{gid}/messages/{mid}",
    region: "us-central1",
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // hard-delete — nothing to maintain

    const data = after.data() as MessageDoc | undefined;
    if (!data) return;

    const expected = tokenize(data.body);
    if (tokensEqual(expected, data.searchTokens)) return;

    const { gid, mid } = event.params;
    try {
      await getFirestore()
        .collection("groups")
        .doc(gid)
        .collection("messages")
        .doc(mid)
        .update({ searchTokens: expected });
    } catch (err) {
      logger.error("search_tokens_update_failed", {
        gid,
        mid,
        eventId: event.id,
        error: (err as Error).message,
      });
      throw err;
    }
  },
);
