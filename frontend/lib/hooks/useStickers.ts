"use client";

import { useEffect, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";

export type Sticker = {
  id: string;
  slug: string;
  name: string;
  audience: string;
  order: number;
  color: string;
};

type StickerListResponse = {
  stickers: Array<{
    slug: string;
    name: string;
    audience: string;
    order: number;
    color: string;
  }>;
  etag: string;
};

// Module-level cache — one fetch per browser session, cleared on page reload.
// Mirrors the prior behaviour so callers see the same memoisation.
let _cache: Sticker[] | null = null;
let _promise: Promise<Sticker[]> | null = null;

function loadStickers(): Promise<Sticker[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = apiGet<StickerListResponse>("/api/stickers")
    .then((res) => {
      _cache = res.stickers.map((s) => ({ id: s.slug, ...s }));
      _promise = null;
      return _cache;
    })
    .catch((err) => {
      _promise = null;
      throw err;
    });
  return _promise;
}

export function useStickers() {
  const [stickers, setStickers] = useState<Sticker[]>(() => _cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) {
      setStickers(_cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    loadStickers()
      .then((s) => {
        if (cancelled) return;
        setStickers(s);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // ApiError is logged but swallowed — components render an empty
        // sticker list, matching prior failure behaviour.
        if (err instanceof ApiError) {
          console.warn("stickers_load_failed", err.code, err.status);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { stickers, loading };
}
