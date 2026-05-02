"use client";

import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export type DiscoverGroup = {
  gid: string;
  name: string;
  description: string;
  memberCount: number;
  audience: "christian" | "bjj" | "general";
  joinMode: "open" | "request";
  leaderUids: string[];
  stickerMixSnapshot: object[];
};

type Page = {
  groups: DiscoverGroup[];
  nextCursor: string | null;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; groups: DiscoverGroup[]; nextCursor: string | null }
  | { status: "error"; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function useDiscoverGroups(params: {
  audience?: string;
  q?: string;
}) {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: "idle" });
  const cursorRef = useRef<string | null>(null);

  const load = useCallback(
    async (append = false) => {
      if (!user) return;
      setState((s) =>
        append && s.status === "ok"
          ? { status: "ok", groups: s.groups, nextCursor: s.nextCursor }
          : { status: "loading" },
      );

      const url = new URL(`${API_URL}/api/discover/groups`);
      if (params.audience) url.searchParams.set("audience", params.audience);
      if (params.q) url.searchParams.set("q", params.q);
      if (append && cursorRef.current) url.searchParams.set("cursor", cursorRef.current);

      try {
        const token = await user.getIdToken();
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setState({ status: "error", message: "Failed to load groups" });
          return;
        }
        const page = (await res.json()) as Page;
        cursorRef.current = page.nextCursor ?? null;
        setState((s) => ({
          status: "ok",
          groups: append && s.status === "ok" ? [...s.groups, ...page.groups] : page.groups,
          nextCursor: page.nextCursor ?? null,
        }));
      } catch {
        setState({ status: "error", message: "Network error" });
      }
    },
    [user, params.audience, params.q],
  );

  const loadMore = useCallback(() => load(true), [load]);

  return { state, load, loadMore };
}
