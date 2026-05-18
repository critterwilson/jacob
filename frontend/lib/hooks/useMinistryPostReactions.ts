"use client";

import { useCallback, useRef } from "react";

import { ApiError, apiDelete, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type ReactionResponse = {
  uid: string;
  slug: string;
  reactedAt: string;
  reactionCounts: Record<string, number>;
};

/**
 * Reactions for ministry-feed posts. Mirrors `useBoardPostReactions` —
 * same `ReactionBar` contract. Only the path differs.
 */
export function useMinistryPostReactions() {
  const { user } = useAuth();
  const myReactionsRef = useRef<Set<string>>(new Set());

  const isMyReaction = useCallback(
    (postId: string, slug: string): boolean =>
      myReactionsRef.current.has(`${postId}:${slug}`),
    [],
  );

  const react = useCallback(
    async (postId: string, slug: string) => {
      if (!user) return;
      const key = `${postId}:${slug}`;
      myReactionsRef.current.add(key);
      try {
        await apiPost<ReactionResponse, undefined>(
          `/api/ministry-feed/posts/${postId}/reactions/${slug}`,
          undefined,
        );
      } catch (err) {
        myReactionsRef.current.delete(key);
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("ministry_reaction_failed", err.code, err.status);
        }
      }
    },
    [user],
  );

  const unreact = useCallback(
    async (postId: string, slug: string) => {
      if (!user) return;
      const key = `${postId}:${slug}`;
      myReactionsRef.current.delete(key);
      try {
        await apiDelete<{ reactionCounts: Record<string, number> }>(
          `/api/ministry-feed/posts/${postId}/reactions/${slug}`,
        );
      } catch (err) {
        myReactionsRef.current.add(key);
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("ministry_unreaction_failed", err.code, err.status);
        }
      }
    },
    [user],
  );

  const toggle = useCallback(
    (postId: string, slug: string) => {
      if (isMyReaction(postId, slug)) return unreact(postId, slug);
      return react(postId, slug);
    },
    [isMyReaction, react, unreact],
  );

  return { react, unreact, toggle, isMyReaction };
}
