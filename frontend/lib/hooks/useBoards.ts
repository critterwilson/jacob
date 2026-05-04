"use client";

import useSWR from "swr";

import { ApiError, apiGet } from "@/lib/api";

export type Board = {
  boardId: string;
  name: string;
  slug: string;
  description: string;
  audience: "christian" | "general";
  archivedAt: string | null;
  postCount: number;
};

type BoardListResponse = {
  boards: Board[];
};

/**
 * Boards list.
 *
 * As of M3 this calls `GET /api/boards` (which already existed pre-
 * migration) and caches the response via SWR with a 5-minute
 * deduping window. Boards are static-ish so the previous `onSnapshot`
 * was cosmetic.
 */
export function useBoards() {
  const { data, error, isLoading, mutate } = useSWR<BoardListResponse>(
    "/api/boards",
    (key: string) => apiGet<BoardListResponse>(key),
    {
      dedupingInterval: 5 * 60_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );

  const boards: Board[] = data?.boards.filter((b) => b.archivedAt == null) ?? [];

  return {
    boards,
    loading: isLoading,
    error: error instanceof ApiError ? error.message : null,
    refresh: () => void mutate(),
  };
}
