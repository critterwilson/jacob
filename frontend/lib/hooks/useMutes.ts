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
 * Subscribe to the current user's mute set.
 *
 * Mute is one-directional: A muting B hides B's messages from A's view,
 * but B is unaffected. Self-mute is rejected by the rule and skipped
 * client-side. Notifications (T34, T35) consult the same set.
 *
 * Returns:
 *   - `mutedSet` — a Set of muted UIDs (for O(1) checks in MessageList).
 *   - `isMuted(uid)` — sugar for membership check.
 *   - `mute(uid)` / `unmute(uid)` — write helpers.
 *   - `loading` — true until the first snapshot fires.
 */
export function useMutes() {
  const { user } = useAuth();
  const [mutedSet, setMutedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setMutedSet(new Set());
      setLoading(false);
      return;
    }
    const ref = collection(firestore, "users", user.uid, "mutes");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setMutedSet(new Set(snap.docs.map((d) => d.id)));
        setLoading(false);
      },
      () => {
        setMutedSet(new Set());
        setLoading(false);
      },
    );
    return unsub;
  }, [user]);

  const mute = useCallback(
    async (otherUid: string) => {
      if (!user || otherUid === user.uid) return;
      await setDoc(doc(firestore, "users", user.uid, "mutes", otherUid), {
        mutedAt: serverTimestamp(),
      });
    },
    [user],
  );

  const unmute = useCallback(
    async (otherUid: string) => {
      if (!user) return;
      await deleteDoc(doc(firestore, "users", user.uid, "mutes", otherUid));
    },
    [user],
  );

  const isMuted = useCallback((uid: string) => mutedSet.has(uid), [mutedSet]);

  return { mutedSet, isMuted, mute, unmute, loading };
}
