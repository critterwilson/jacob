"use client";

import { useCallback, useEffect, useRef } from "react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, apiDelete, apiPost } from "@/lib/api";
import type { Message } from "@/lib/hooks/useGroupMessages";

// Server response for POST /reactions/{slug}. `reactionCounts` was dropped
// in PR9 / H7 — the pre-trigger snapshot it carried was stale; the next
// polled message-list response is authoritative.
type ReactionResponse = {
  uid: string;
  slug: string;
  reactedAt: string;
};

/**
 * Group-message reactions.
 *
 * Toggle calls `POST/DELETE /api/groups/{gid}/messages/{mid}/reactions/{slug}`.
 * Optimistic local state lives in `myReactionsRef`. The ref is hydrated
 * from each message's server-supplied `myReactions` whenever `messages`
 * changes — that's the bit fixing the bug where, after a refresh, the
 * "I reacted" state was lost and the toggle treated the user's existing
 * reaction as a new one (see PR4 / C4).
 *
 * Optimistic adds set during a toggle are preserved across re-hydrations
 * via the `optimisticDeltaRef` overlay until the next server response
 * lands them — the server is then authoritative.
 */
export function useReactions(gid: string, messages?: readonly Message[]) {
  const { user } = useAuth();
  const myReactionsRef = useRef<Set<string>>(new Set());
  // Tracks slugs added/removed locally that haven't been observed in the
  // server response yet, so a post-toggle hydrate doesn't snap them away
  // before the next poll merges the change in.
  const optimisticAddRef = useRef<Set<string>>(new Set());
  const optimisticRemoveRef = useRef<Set<string>>(new Set());

  // Re-seed from the message stream whenever it changes. Server is
  // authoritative; local optimistic deltas overlay on top.
  useEffect(() => {
    if (!messages) return;
    const next = new Set<string>();
    for (const m of messages) {
      if (!m.myReactions) continue;
      for (const slug of m.myReactions) next.add(`${m.id}:${slug}`);
    }
    // Apply optimistic overlay; clear entries the server now confirms.
    optimisticAddRef.current.forEach((key) => {
      if (next.has(key)) optimisticAddRef.current.delete(key);
      else next.add(key);
    });
    optimisticRemoveRef.current.forEach((key) => {
      if (!next.has(key)) optimisticRemoveRef.current.delete(key);
      else next.delete(key);
    });
    myReactionsRef.current = next;
  }, [messages]);

  const isMyReaction = useCallback(
    (mid: string, slug: string): boolean =>
      myReactionsRef.current.has(`${mid}:${slug}`),
    [],
  );

  const react = useCallback(
    async (mid: string, slug: string) => {
      if (!user) return;
      const key = `${mid}:${slug}`;
      myReactionsRef.current.add(key);
      optimisticAddRef.current.add(key);
      optimisticRemoveRef.current.delete(key);
      try {
        await apiPost<ReactionResponse, undefined>(
          `/api/groups/${gid}/messages/${mid}/reactions/${slug}`,
          undefined,
        );
      } catch (err) {
        myReactionsRef.current.delete(key);
        optimisticAddRef.current.delete(key);
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("reaction_failed", err.code, err.status);
        }
      }
    },
    [gid, user],
  );

  const unreact = useCallback(
    async (mid: string, slug: string) => {
      if (!user) return;
      const key = `${mid}:${slug}`;
      myReactionsRef.current.delete(key);
      optimisticRemoveRef.current.add(key);
      optimisticAddRef.current.delete(key);
      try {
        await apiDelete<{ ok: boolean }>(
          `/api/groups/${gid}/messages/${mid}/reactions/${slug}`,
        );
      } catch (err) {
        myReactionsRef.current.add(key);
        optimisticRemoveRef.current.delete(key);
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("unreaction_failed", err.code, err.status);
        }
      }
    },
    [gid, user],
  );

  const toggle = useCallback(
    (mid: string, slug: string) => {
      if (isMyReaction(mid, slug)) return unreact(mid, slug);
      return react(mid, slug);
    },
    [isMyReaction, react, unreact],
  );

  return { react, unreact, toggle, isMyReaction };
}
