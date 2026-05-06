"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, apiDelete, apiPost } from "@/lib/api";
import type { Message } from "@/lib/hooks/useGroupMessages";

// Server response for POST /reactions/{slug}. `reactionCounts` was dropped
// in PR9 / H7 — the pre-trigger snapshot it carried was stale; the next
// polled message-list response is authoritative.
type ReactionResponse = {
  uid: string;
  slug: string;
  reactedAt: string;
};

const key = (mid: string, slug: string): string => `${mid}:${slug}`;
const splitKey = (k: string): [string, string] => {
  const i = k.indexOf(":");
  return [k.slice(0, i), k.slice(i + 1)];
};

/**
 * Group-message reactions.
 *
 * Toggle calls `POST/DELETE /api/groups/{gid}/messages/{mid}/reactions/{slug}`.
 * The hook tracks two state slices:
 *   - `optimisticAdd` / `optimisticRemove`: client-side deltas issued by
 *     the current user that haven't yet been observed in the server
 *     response. Both flip in `react()` / `unreact()` to make the UI
 *     update SYNCHRONOUSLY (the previous ref-based version updated a
 *     mutable Set, which never triggered a re-render — the chip didn't
 *     toggle visually until the next 10s poll).
 *   - The `messages` prop is treated as the server-of-record; on every
 *     update we drop optimistic entries that the server has now confirmed
 *     (added entries that now appear in `myReactions`; removed entries
 *     that no longer appear).
 *
 * `mergeReactionCounts(mid, base)` returns the chip counts to render —
 * `base` plus the optimistic delta, plus any slug the user has just
 * reacted with for the first time on this message (so a brand-new
 * sticker shows up immediately instead of after the next 10s poll).
 */
export function useReactions(gid: string, messages?: readonly Message[]) {
  const { user } = useAuth();
  // The setters always create a new Set, so the value is treated as
  // immutable in practice — the type is plain `Set` because TS narrows
  // for-of over ReadonlySet awkwardly with the project's tsconfig target.
  const [optimisticAdd, setOptimisticAdd] = useState<Set<string>>(
    () => new Set(),
  );
  const [optimisticRemove, setOptimisticRemove] = useState<Set<string>>(
    () => new Set(),
  );

  // Keep the latest `messages` reference around for `react`/`unreact`
  // closures so we don't have to rebuild them on every render.
  const messagesRef = useRef<readonly Message[] | undefined>(messages);
  messagesRef.current = messages;

  // On every messages update, drop optimistic entries the server now
  // confirms — adds that now appear in myReactions, removes that no
  // longer appear.
  useEffect(() => {
    if (!messages) return;
    const serverHas = new Set<string>();
    for (const m of messages) {
      if (!m.myReactions) continue;
      m.myReactions.forEach((slug) => serverHas.add(key(m.id, slug)));
    }
    setOptimisticAdd((prev) => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach((k) => {
        if (serverHas.has(k)) {
          next.delete(k);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setOptimisticRemove((prev) => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach((k) => {
        const [mid] = splitKey(k);
        // Only drop the pending remove once the server-of-record for that
        // message has come back without the slug. If the message hasn't
        // been re-fetched yet, hold the optimistic state.
        const messageStillPresent = messages.some((m) => m.id === mid);
        if (messageStillPresent && !serverHas.has(k)) {
          next.delete(k);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [messages]);

  const isMyReaction = useCallback(
    (mid: string, slug: string): boolean => {
      const k = key(mid, slug);
      if (optimisticRemove.has(k)) return false;
      if (optimisticAdd.has(k)) return true;
      const m = messagesRef.current?.find((x) => x.id === mid);
      return Boolean(m?.myReactions?.includes(slug));
    },
    [optimisticAdd, optimisticRemove],
  );

  const mergeReactionCounts = useCallback(
    (
      mid: string,
      base: Record<string, number> | undefined,
    ): Record<string, number> => {
      const out: Record<string, number> = { ...(base ?? {}) };
      optimisticAdd.forEach((k) => {
        const [m, slug] = splitKey(k);
        if (m !== mid) return;
        out[slug] = (out[slug] ?? 0) + 1;
      });
      optimisticRemove.forEach((k) => {
        const [m, slug] = splitKey(k);
        if (m !== mid) return;
        out[slug] = Math.max(0, (out[slug] ?? 0) - 1);
      });
      return out;
    },
    [optimisticAdd, optimisticRemove],
  );

  const react = useCallback(
    async (mid: string, slug: string) => {
      if (!user) return;
      const k = key(mid, slug);
      setOptimisticAdd((prev) => {
        if (prev.has(k)) return prev;
        const next = new Set(prev);
        next.add(k);
        return next;
      });
      setOptimisticRemove((prev) => {
        if (!prev.has(k)) return prev;
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
      try {
        await apiPost<ReactionResponse, undefined>(
          `/api/groups/${gid}/messages/${mid}/reactions/${slug}`,
          undefined,
        );
      } catch (err) {
        // Roll back the optimistic add — leave server state untouched.
        setOptimisticAdd((prev) => {
          if (!prev.has(k)) return prev;
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("reaction_failed", err.code, err.status);
        }
      }
    },
    [gid, user],
  );

  const unreact = useCallback(
    async (mid: string, slug: string) => {
      if (!user) return;
      const k = key(mid, slug);
      setOptimisticRemove((prev) => {
        if (prev.has(k)) return prev;
        const next = new Set(prev);
        next.add(k);
        return next;
      });
      setOptimisticAdd((prev) => {
        if (!prev.has(k)) return prev;
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
      try {
        await apiDelete<{ ok: boolean }>(
          `/api/groups/${gid}/messages/${mid}/reactions/${slug}`,
        );
      } catch (err) {
        // Roll back the optimistic remove.
        setOptimisticRemove((prev) => {
          if (!prev.has(k)) return prev;
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("unreaction_failed", err.code, err.status);
        }
      }
    },
    [gid, user],
  );

  const toggle = useCallback(
    (mid: string, slug: string) => {
      if (isMyReaction(mid, slug)) return unreact(mid, slug);
      return react(mid, slug);
    },
    [isMyReaction, react, unreact],
  );

  return { react, unreact, toggle, isMyReaction, mergeReactionCounts };
}
