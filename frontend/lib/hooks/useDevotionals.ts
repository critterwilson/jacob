"use client";

import { useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type Devotional = {
  slug: string;
  title: string;
  scriptureRef: string;
  body: string;
  audioUrl: string | null;
  sourceAttribution: string;
  publishedAt: string | null;
  audience: "christian" | "general";
};

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

export function useDevotional(slug: string | null): {
  devotional: Devotional | null;
  loading: boolean;
} {
  const [devotional, setDevotional] = useState<Devotional | null>(null);
  const [loading, setLoading] = useState(Boolean(slug));

  useEffect(() => {
    if (!slug) {
      setDevotional(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    apiGet<Devotional>(`/api/devotionals/${encodeURIComponent(slug)}`, {
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
  }, [slug]);

  return { devotional, loading };
}
