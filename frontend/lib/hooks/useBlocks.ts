"use client";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";

/**
 * Subscribe to the current user's block set.
 *
 * Block is stronger than mute: blocked-user messages are hidden
 * entirely (not collapsed), the blocker disappears from the blockee's
 * mention autocomplete (T27), and no notifications fire on either side.
 * Block is one-directional — symmetric blocking is a Phase 3 escalation
 * tool. Self-block is rejected by the rule and skipped client-side.
 *
 * Returns the same shape as useMutes plus a list view for the
 * /settings/blocked page.
 */
export function useBlocks() {
  const { user } = useAuth();
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setBlockedSet(new Set());
      setLoading(false);
      return;
    }
    const ref = collection(firestore, "users", user.uid, "blocks");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setBlockedSet(new Set(snap.docs.map((d) => d.id)));
        setLoading(false);
      },
      () => {
        setBlockedSet(new Set());
        setLoading(false);
      },
    );
    return unsub;
  }, [user]);

  const block = useCallback(
    async (otherUid: string) => {
      if (!user || otherUid === user.uid) return;
      await setDoc(doc(firestore, "users", user.uid, "blocks", otherUid), {
        blockedAt: serverTimestamp(),
      });
    },
    [user],
  );

  const unblock = useCallback(
    async (otherUid: string) => {
      if (!user) return;
      await deleteDoc(doc(firestore, "users", user.uid, "blocks", otherUid));
    },
    [user],
  );

  const isBlocked = useCallback(
    (uid: string) => blockedSet.has(uid),
    [blockedSet],
  );

  return {
    blockedSet,
    isBlocked,
    block,
    unblock,
    loading,
    blockedList: Array.from(blockedSet),
  };
}
