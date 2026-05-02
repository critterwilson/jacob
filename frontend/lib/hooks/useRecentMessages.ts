"use client";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Timestamp,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebase";
import type { Group } from "@/lib/hooks/useGroups";

export type RecentMessage = {
  id: string;
  gid: string;
  groupName: string;
  authorUid: string;
  body: string;
  createdAt: Timestamp | null;
  deletedAt: Timestamp | null;
  mediaRefs: string[];
};

export function useRecentMessages(groups: Group[]) {
  const [messages, setMessages] = useState<RecentMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const groupKey = groups.map((g) => g.id).join(",");

  useEffect(() => {
    if (groups.length === 0) {
      setMessages([]);
      return;
    }

    setLoading(true);
    let cancelled = false;

    async function fetchRecent() {
      try {
        const perGroup = Math.max(3, Math.ceil(12 / groups.length));
        const nameMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

        const perGroupResults = await Promise.all(
          groups.map(async (g) => {
            const q = query(
              collection(firestore, "groups", g.id, "messages"),
              where("parentMessageId", "==", null),
              orderBy("createdAt", "desc"),
              limit(perGroup),
            );
            const snap = await getDocs(q);
            return snap.docs.map((d) => ({
              id: d.id,
              gid: g.id,
              groupName: nameMap[g.id] ?? "",
              ...(d.data() as Omit<RecentMessage, "id" | "gid" | "groupName">),
            }));
          }),
        );

        if (cancelled) return;

        const merged = perGroupResults
          .flat()
          .filter((m) => m.deletedAt === null || m.deletedAt === undefined)
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis() ?? 0;
            const tb = b.createdAt?.toMillis() ?? 0;
            return tb - ta;
          })
          .slice(0, 10);

        setMessages(merged);
      } catch {
        // Firestore unavailable — leave messages empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchRecent();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey]);

  return { messages, loading };
}
