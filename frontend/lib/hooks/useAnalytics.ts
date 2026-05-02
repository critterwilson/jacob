"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export type StickerMixItem = { slug: string; count: number; percent: number };
export type ContributorItem = { uid: string; displayName: string; count: number };
export type CadencePoint = { day: string; count: number };

export type AnalyticsData = {
  gid: string;
  range: "7d" | "30d";
  totalMessages: number;
  stickerMix: StickerMixItem[];
  topContributors: ContributorItem[];
  cadenceByDay: CadencePoint[];
  generatedAt: string;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: AnalyticsData }
  | { status: "error"; code: string; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// 1-hour in-process SWR-style cache
const _cache = new Map<string, { data: AnalyticsData; expiresAt: number }>();

export function useAnalytics(gid: string, range: "7d" | "30d") {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const fetch_ = useCallback(async () => {
    if (!user || !gid) return;
    const key = `${gid}:${range}`;
    const cached = _cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      setState({ status: "ok", data: cached.data });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "loading" });
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${API_URL}/api/groups/${gid}/analytics?range=${range}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setState({
          status: "error",
          code: err?.error?.code ?? "unknown",
          message: err?.error?.message ?? "Failed to load analytics",
        });
        return;
      }
      const data = (await res.json()) as AnalyticsData;
      _cache.set(key, { data, expiresAt: Date.now() + 3_600_000 });
      setState({ status: "ok", data });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setState({ status: "error", code: "network_error", message: "Network error" });
    }
  }, [user, gid, range]);

  useEffect(() => {
    void fetch_();
    return () => abortRef.current?.abort();
  }, [fetch_]);

  return { state, refetch: fetch_ };
}
