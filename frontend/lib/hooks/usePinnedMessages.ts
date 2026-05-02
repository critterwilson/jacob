"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";

import { firestore } from "@/lib/firebase";

export type PinnedMessage = {
  id: string;
  body: string;
  authorUid: string;
  announcedAt: Timestamp | null;
};

export function usePinnedMessages(gid: string) {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  // Listen to group doc for pinnedMessageIds changes.
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

  // Fetch message docs whenever pinnedIds changes.
  useEffect(() => {
    if (pinnedIds.length === 0) {
      setPinned([]);
      return;
    }
    void (async () => {
      const snaps = await Promise.all(
        pinnedIds.map((id) =>
          getDoc(doc(firestore, "groups", gid, "messages", id)),
        ),
      );
      const messages = snaps
        .filter((s) => s.exists())
        .map((s) => {
          const d = s.data()!;
          return {
            id: s.id,
            body: (d.body as string) ?? "",
            authorUid: (d.authorUid as string) ?? "",
            announcedAt: (d.announcedAt as Timestamp | null) ?? null,
          };
        });
      setPinned(messages);
    })();
  }, [gid, pinnedIds]);

  const togglePin = async (mid: string) => {
    const { updateDoc } = await import("firebase/firestore");
    const next = pinnedIds.includes(mid)
      ? pinnedIds.filter((id) => id !== mid)
      : [mid, ...pinnedIds].slice(0, 5);
    await updateDoc(doc(firestore, "groups", gid), { pinnedMessageIds: next });
  };

  return { pinned, pinnedIds, loading, togglePin };
}
