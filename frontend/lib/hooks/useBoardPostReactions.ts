"use client";

import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useCallback, useRef } from "react";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";

/**
 * T32 — sibling of useReactions, keyed on the boards path.
 * The two hooks intentionally share the same surface so components like
 * ReactionBar / ReactionPicker can be passed either set of callbacks.
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
      myReactionsRef.current.add(`${_postId}:${slug}`);
      const ref = doc(
        firestore,
        "boards",
        boardId,
        "posts",
        _postId,
        "reactions",
        slug,
        "users",
        user.uid,
      );
      await setDoc(ref, { reactedAt: serverTimestamp() });
    },
    [boardId, user],
  );

  const unreact = useCallback(
    async (_postId: string, slug: string) => {
      if (!user) return;
      myReactionsRef.current.delete(`${_postId}:${slug}`);
      const ref = doc(
        firestore,
        "boards",
        boardId,
        "posts",
        _postId,
        "reactions",
        slug,
        "users",
        user.uid,
      );
      await deleteDoc(ref);
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

  // Suppress unused-var by referencing in toggle path
  void postId;

  return { react, unreact, toggle, isMyReaction };
}
