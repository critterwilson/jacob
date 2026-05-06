"use client";

import { useCallback, useRef, useState } from "react";

import { apiGet } from "@/lib/api";
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

      const search = new URLSearchParams();
      if (params.audience) search.set("audience", params.audience);
      if (params.q) search.set("q", params.q);
      if (append && cursorRef.current) search.set("cursor", cursorRef.current);
      const qs = search.toString();
      const path = qs ? `/api/discover/groups?${qs}` : "/api/discover/groups";

      try {
        const page = await apiGet<Page>(path);
        cursorRef.current = page.nextCursor ?? null;
        setState((s) => ({
          status: "ok",
          groups: append && s.status === "ok" ? [...s.groups, ...page.groups] : page.groups,
          nextCursor: page.nextCursor ?? null,
        }));
      } catch {
        setState({ status: "error", message: "Failed to load groups" });
      }
    },
    [user, params.audience, params.q],
  );

  const loadMore = useCallback(() => load(true), [load]);

  return { state, load, loadMore };
}
