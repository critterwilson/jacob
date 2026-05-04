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
 * Board-post reactions. Sibling of `useReactions`, keyed on the boards
 * path. As of M4 the toggle calls
 * `POST /api/boards/{bid}/posts/{pid}/reactions/{slug}` (or DELETE).
 */
export function useBoardPostReactions(boardId: string, postId: string) {
  const { user } = useAuth();
  const myReactionsRef = useRef<Set<string>>(new Set());

  const isMyReaction = useCallback(
    (_postId: string, slug: string): boolean =>
      myReactionsRef.current.has(`${_postId}:${slug}`),
    [],
  );

  const react = useCallback(
    async (_postId: string, slug: string) => {
      if (!user) return;
      const key = `${_postId}:${slug}`;
      myReactionsRef.current.add(key);
      try {
        await apiPost<ReactionResponse, undefined>(
          `/api/boards/${boardId}/posts/${_postId}/reactions/${slug}`,
          undefined,
        );
      } catch (err) {
        myReactionsRef.current.delete(key);
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("board_reaction_failed", err.code, err.status);
        }
      }
    },
    [boardId, user],
  );

  const unreact = useCallback(
    async (_postId: string, slug: string) => {
      if (!user) return;
      const key = `${_postId}:${slug}`;
      myReactionsRef.current.delete(key);
      try {
        await apiDelete<{ reactionCounts: Record<string, number> }>(
          `/api/boards/${boardId}/posts/${_postId}/reactions/${slug}`,
        );
      } catch (err) {
        myReactionsRef.current.add(key);
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("board_unreaction_failed", err.code, err.status);
        }
      }
    },
    [boardId, user],
  );

  const toggle = useCallback(
    (_postId: string, slug: string) => {
      if (isMyReaction(_postId, slug)) return unreact(_postId, slug);
      return react(_postId, slug);
    },
    [isMyReaction, react, unreact],
  );

  void postId;
  return { react, unreact, toggle, isMyReaction };
}
