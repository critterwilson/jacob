"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiDelete, apiPatch, apiPost, apiGet } from "@/lib/api";

export type Devotional = {
  // Title-derived slug (e.g. "the-lord-is-my-shepherd"). Use `path`
  // when building URLs — `slug` is just the title-derived piece.
  slug: string;
  // Canonical URL path segment under `/devotionals/`:
  //   platform-wide → "org/<slug>"
  //   group-scoped  → "group/<authorHash>/<slug>"
  //   legacy        → "<slug>" (pre-rename docs, same as legacy URL)
  path: string;
  title: string;
  scriptureRef: string;
  body: string;
  audioUrl: string | null;
  sourceAttribution: string;
  publishedAt: string | null;
  audience: "christian" | "general";
  // null = platform-wide (ministry-owner-authored). Set = group-scoped
  // (leader-authored); only members of the named group can see it.
  groupId: string | null;
  // Hydrated by list endpoints that merge across groups. The
  // /api/devotionals list returns null for platform entries and the
  // group's display name for group-scoped entries.
  groupName: string | null;
  // 8-char stable hash of the author's uid; populated for group-scoped
  // entries (it's the second URL segment) and null on platform-wide.
  authorHash: string | null;
};

export type DevotionalCreatePayload = {
  // Slug is auto-derived from the title server-side; the form no longer
  // collects one.
  title: string;
  scriptureRef?: string;
  body: string;
  audioUrl?: string | null;
  sourceAttribution?: string;
  publishedAt?: string | null;
  audience?: "christian" | "general";
  // When set, the devotional is created as group-scoped and the backend
  // enforces that the caller is a leader of `groupId`. When omitted, the
  // create defaults to a platform-wide devotional and requires the
  // `ministry_owner` claim.
  groupId?: string | null;
};

export type DevotionalUpdatePayload = Partial<DevotionalCreatePayload>;

// Build the API path for a single devotional from its `path` field.
// Caller-facing routes accept the same shape because every segment of
// the structured path is URL-safe ASCII.
function apiPathFor(devotionalPath: string): string {
  return `/api/devotionals/${devotionalPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
}

export function useDevotionalMutations(): {
  createDevotional: (payload: DevotionalCreatePayload) => Promise<Devotional | null>;
  patchDevotional: (
    devotionalPath: string,
    payload: DevotionalUpdatePayload,
  ) => Promise<Devotional | null>;
  deleteDevotional: (devotionalPath: string) => Promise<boolean>;
} {
  const createDevotional = useCallback(
    async (payload: DevotionalCreatePayload): Promise<Devotional | null> => {
      try {
        return await apiPost<Devotional, DevotionalCreatePayload>(
          "/api/devotionals",
          payload,
        );
      } catch {
        return null;
      }
    },
    [],
  );

  const patchDevotional = useCallback(
    async (
      devotionalPath: string,
      payload: DevotionalUpdatePayload,
    ): Promise<Devotional | null> => {
      try {
        return await apiPatch<Devotional, DevotionalUpdatePayload>(
          apiPathFor(devotionalPath),
          payload,
        );
      } catch {
        return null;
      }
    },
    [],
  );

  const deleteDevotional = useCallback(
    async (devotionalPath: string): Promise<boolean> => {
      try {
        await apiDelete(apiPathFor(devotionalPath));
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  return { createDevotional, patchDevotional, deleteDevotional };
}

export function useDevotionals(audience?: "christian" | "general"): {
  devotionals: Devotional[];
  loading: boolean;
} {
  const [devotionals, setDevotionals] = useState<Devotional[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const path = audience
      ? `/api/devotionals?audience=${encodeURIComponent(audience)}`
      : "/api/devotionals";
    apiGet<{ devotionals: Devotional[] }>(path, { signal: ctrl.signal })
      .then((res) => {
        setDevotionals(res.devotionals);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setDevotionals([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [audience]);

  return { devotionals, loading };
}

export function useGroupDevotionals(gid: string | null | undefined): {
  devotionals: Devotional[];
  loading: boolean;
  reload: () => void;
} {
  const [devotionals, setDevotionals] = useState<Devotional[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(gid));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!gid) {
      setDevotionals([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<{ devotionals: Devotional[] }>(
      `/api/groups/${encodeURIComponent(gid)}/devotionals`,
      { signal: ctrl.signal },
    )
      .then((res) => {
        setDevotionals(res.devotionals);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setDevotionals([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [gid, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { devotionals, loading, reload };
}


export function useDevotional(devotionalPath: string | null): {
  devotional: Devotional | null;
  loading: boolean;
} {
  const [devotional, setDevotional] = useState<Devotional | null>(null);
  const [loading, setLoading] = useState(Boolean(devotionalPath));

  useEffect(() => {
    if (!devotionalPath) {
      setDevotional(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    apiGet<Devotional>(apiPathFor(devotionalPath), {
      signal: ctrl.signal,
    })
      .then((res) => {
        setDevotional(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setDevotional(null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [devotionalPath]);

  return { devotional, loading };
}
