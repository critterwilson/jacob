"use client";

import { useCallback, useRef } from "react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, apiDelete, apiPost } from "@/lib/api";

type ReactionResponse = {
  uid: string;
  slug: string;
  reactedAt: string;
  reactionCounts: Record<string, number>;
};

/**
 * Group-message reactions.
 *
 * As of M4 the toggle calls `POST /api/groups/{gid}/messages/{mid}/reactions/{slug}`
 * (or DELETE) instead of the prior `setDoc / deleteDoc` Firestore client
 * calls. Optimistic local state is kept on `myReactionsRef`; backend
 * errors are swallowed (the UI's reactionCounts is sourced from the
 * message doc which the polling refresh will catch up to).
 */
export function useReactions(gid: string) {
  const { user } = useAuth();
  const myReactionsRef = useRef<Set<string>>(new Set());

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
      try {
        await apiPost<ReactionResponse, undefined>(
          `/api/groups/${gid}/messages/${mid}/reactions/${slug}`,
          undefined,
        );
      } catch (err) {
        myReactionsRef.current.delete(key);
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
      try {
        await apiDelete<{ reactionCounts: Record<string, number> }>(
          `/api/groups/${gid}/messages/${mid}/reactions/${slug}`,
        );
      } catch (err) {
        myReactionsRef.current.add(key);
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
