"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

export type SearchHit = {
  messageRef: string;
  groupId: string;
  authorUid: string;
  authorDisplayName: string | null;
  body: string;
  createdAt: string;
  parentMessageId: string | null;
};

export type SearchResponse = {
  hits: SearchHit[];
  total: number;
  page: number;
  perPage: number;
};

type SearchState = {
  data: SearchResponse | null;
  loading: boolean;
  error: string | null;
};

const DEBOUNCE_MS = 300;

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Debounced fetch against `/api/search`.
 *
 * - Empty / whitespace `q` returns no-op state (no request).
 * - Cancels in-flight requests on unmount or when `q`/`page` changes
 *   (prevents stale results clobbering newer ones).
 * - Errors are surfaced as a string so the caller can render them.
 */
export function useSearch(q: string, page: number = 1, perPage: number = 8) {
  const { user } = useAuth();
  const [state, setState] = useState<SearchState>({
    data: null,
    loading: false,
    error: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (controller.current) controller.current.abort();

    const trimmed = q.trim();
    if (!trimmed || !user) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    timer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      controller.current = ctrl;
      try {
        const token = await user.getIdToken();
        const url = new URL(`${API_BASE}/api/search`);
        url.searchParams.set("q", trimmed);
        url.searchParams.set("page", String(page));
        url.searchParams.set("perPage", String(perPage));

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const msg =
            res.status === 503
              ? "Search is temporarily unavailable."
              : res.status === 429
                ? "Too many searches — slow down."
                : "Search failed.";
          setState({ data: null, loading: false, error: msg });
          return;
        }
        const data = (await res.json()) as SearchResponse;
        setState({ data, loading: false, error: null });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({
          data: null,
          loading: false,
          error: "Search failed.",
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (controller.current) controller.current.abort();
    };
  }, [q, page, perPage, user]);

  return state;
}
