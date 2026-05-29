"use client";

import useSWR from "swr";

import { apiGet } from "@/lib/api";

export type WeeklySermon = {
  weekKey: string;
  videoUrl: string;
  title: string;
  description: string;
  postedAt: string | null;
  postedBy: string | null;
  weekStart: string | null;
};

type WeeklySermonResponse = {
  sermon: WeeklySermon | null;
};

/**
 * `/api/weekly-sermon` — the single org-wide video sermon shown at the
 * top of /home. The backend returns the current ISO week's entry or the
 * most-recent one, so a missing current week still renders a sermon.
 *
 * The doc changes at most once a week, so we dedupe aggressively and
 * only revalidate on focus. `mutate` lets the authoring page refresh the
 * hero immediately after publishing.
 */
export function useWeeklySermon() {
  const { data, isLoading, error, mutate } = useSWR<WeeklySermonResponse>(
    "/api/weekly-sermon",
    (key: string) => apiGet<WeeklySermonResponse>(key),
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );

  return {
    sermon: data?.sermon ?? null,
    loading: isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
