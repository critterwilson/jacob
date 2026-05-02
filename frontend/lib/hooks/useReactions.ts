"use client";

import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useCallback, useRef } from "react";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";

export function useReactions(gid: string) {
  const { user } = useAuth();
  // Optimistic in-memory state keyed by `${mid}:${slug}`.
  // Populated on toggle; rebuilt on page refresh via a one-shot read
  // if needed (v1 omits the initial read — counts come from reactionCounts
  // on the message doc, which is always fresh).
  const myReactionsRef = useRef<Set<string>>(new Set());

  const isMyReaction = useCallback(
    (mid: string, slug: string): boolean => myReactionsRef.current.has(`${mid}:${slug}`),
    [],
  );

  const react = useCallback(
    async (mid: string, slug: string) => {
      if (!user) return;
      const key = `${mid}:${slug}`;
      myReactionsRef.current.add(key);
      const ref = doc(
        firestore,
        "groups",
        gid,
        "messages",
        mid,
        "reactions",
        slug,
        "users",
        user.uid,
      );
      await setDoc(ref, { reactedAt: serverTimestamp() });
    },
    [gid, user],
  );

  const unreact = useCallback(
    async (mid: string, slug: string) => {
      if (!user) return;
      const key = `${mid}:${slug}`;
      myReactionsRef.current.delete(key);
      const ref = doc(
        firestore,
        "groups",
        gid,
        "messages",
        mid,
        "reactions",
        slug,
        "users",
        user.uid,
      );
      await deleteDoc(ref);
    },
    [gid, user],
  );

  const toggle = useCallback(
    (mid: string, slug: string) => {
      if (isMyReaction(mid, slug)) {
        return unreact(mid, slug);
      }
      return react(mid, slug);
    },
    [isMyReaction, react, unreact],
  );

  return { react, unreact, toggle, isMyReaction };
}
