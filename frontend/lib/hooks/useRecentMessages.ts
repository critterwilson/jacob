"use client";

import useSWR from "swr";

import { apiGet } from "@/lib/api";
import type { Group } from "@/lib/hooks/useGroups";

export type RecentMessage = {
  id: string;
  gid: string;
  groupName: string;
  authorUid: string;
  body: string;
  createdAt: string | null;
  deletedAt: string | null;
  mediaRefs: string[];
};

type RecentMessagesResponse = {
  messages: RecentMessage[];
};

/**
 * Cross-group recent-messages feed for the home page.
 *
 * As of M3 the per-group `getDocs` fan-out moves server-side: one call
 * to `GET /api/users/me/recent-messages`. The hook still accepts a
 * `groups` argument so existing call-sites compile unchanged, but the
 * value is only used to suppress the request when the caller is not
 * yet in any group (avoids a noisy request right after sign-up).
 */
export function useRecentMessages(groups: Group[]) {
  const enabled = groups.length > 0;
  const { data, isLoading } = useSWR<RecentMessagesResponse>(
    enabled ? "/api/users/me/recent-messages" : null,
    (key: string) => apiGet<RecentMessagesResponse>(key),
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );

  return {
    messages: data?.messages ?? [],
    loading: enabled && isLoading,
  };
}
