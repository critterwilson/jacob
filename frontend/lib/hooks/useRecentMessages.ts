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
import useSWR from "swr";
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

/**
 * Returns the user's most recent messages across every group they belong to.
 *
 * M12: results are cached via SWR keyed on the sorted comma-separated
 * group ids. Re-mounting the component (e.g. navigating away and back)
 * does not re-fetch within the dedupe window — it serves the cached
 * snapshot immediately and revalidates in the background. The previous
 * implementation issued one independent `getDocs` per group on every
 * mount with zero caching.
 *
 * Cache strategy:
 *   - dedupingInterval: 60s — within one minute, identical key returns
 *     cached data without a refetch.
 *   - revalidateOnFocus / revalidateOnReconnect — on, so going back to
 *     the tab pulls fresh data without thrashing.
 *   - keepPreviousData — surface the previous snapshot during refetch
 *     so the home page doesn't flash empty.
 */
async function fetchRecent(groups: Group[]): Promise<RecentMessage[]> {
  if (groups.length === 0) return [];
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

  return perGroupResults
    .flat()
    .filter((m) => m.deletedAt === null || m.deletedAt === undefined)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis() ?? 0;
      const tb = b.createdAt?.toMillis() ?? 0;
      return tb - ta;
    })
    .slice(0, 10);
}

export function useRecentMessages(groups: Group[]) {
  const groupKey =
    groups.length === 0
      ? null
      : `recent-messages:${groups
          .map((g) => g.id)
          .sort()
          .join(",")}`;

  const { data, isLoading } = useSWR<RecentMessage[]>(
    groupKey,
    () => fetchRecent(groups),
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );

  return { messages: data ?? [], loading: Boolean(groupKey) && isLoading };
}
