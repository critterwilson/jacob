"use client";

import { doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { firestore } from "@/lib/firebase";
import type { Message } from "@/lib/hooks/useGroupMessages";

export type PinnedMessage = {
  message: Message;
};

export function usePinnedMessages(gid: string) {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  // Watch the group doc for pinnedMessageIds changes.
  useEffect(() => {
    if (!gid) return;
    return onSnapshot(
      doc(firestore, "groups", gid),
      (snap) => {
        const ids = (snap.data()?.pinnedMessageIds as string[] | undefined) ?? [];
        setPinnedIds(ids);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [gid]);

  // Resolve ids → message docs whenever the ids change.
  useEffect(() => {
    if (!gid || pinnedIds.length === 0) {
      setPinned([]);
      return;
    }
    let cancelled = false;
    const resolve = async () => {
      const snaps = await Promise.all(
        pinnedIds.map((mid) =>
          getDoc(doc(firestore, "groups", gid, "messages", mid)),
        ),
      );
      if (cancelled) return;
      const resolved: PinnedMessage[] = snaps
        .filter((s) => s.exists())
        .map((s) => ({
          message: { id: s.id, ...(s.data() as Omit<Message, "id">) },
        }));
      setPinned(resolved);
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [gid, pinnedIds]);

  const isPinned = useCallback(
    (mid: string) => pinnedIds.includes(mid),
    [pinnedIds],
  );

  const togglePin = useCallback(
    async (mid: string) => {
      const next = isPinned(mid)
        ? pinnedIds.filter((id) => id !== mid)
        : [mid, ...pinnedIds].slice(0, 5);
      await updateDoc(doc(firestore, "groups", gid), { pinnedMessageIds: next });
    },
    [gid, isPinned, pinnedIds],
  );

  return { pinned, pinnedIds, isPinned, togglePin, loading };
}
