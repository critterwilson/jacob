"use client";

// T53 — client-side ephemeral unfurl. Calls `POST /api/unfurl` for
// each URL in a message body and caches the result for the browser
// session. Useful for the "post a YouTube link, see the preview"
// flow before the trigger persists `unfurls` on the message doc
// (the persisted-unfurl trigger is a follow-up).

import { useEffect, useState } from "react";

import { apiPost, ApiError } from "@/lib/api";
import type { Unfurl } from "@/components/chat/MessageBody";

const URL_RE = /(https?:\/\/[^\s)<>"]+)/g;
const MAX_PER_MESSAGE = 3;

const _cache = new Map<string, Unfurl>();
const _inflight = new Map<string, Promise<Unfurl>>();

export function extractUrls(body: string): string[] {
  const matches = body.match(URL_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
    if (out.length >= MAX_PER_MESSAGE) break;
  }
  return out;
}

async function fetchOne(url: string): Promise<Unfurl> {
  const cached = _cache.get(url);
  if (cached) return cached;
  const inflight = _inflight.get(url);
  if (inflight) return inflight;
  const promise = apiPost<Unfurl>("/api/unfurl", { url })
    .then((res) => {
      _cache.set(url, res);
      _inflight.delete(url);
      return res;
    })
    .catch((err: unknown) => {
      _inflight.delete(url);
      if (err instanceof ApiError) {
        console.warn("unfurl_failed", err.code, err.status);
      }
      const fallback: Unfurl = {
        url,
        title: null,
        description: null,
        imageUrl: null,
        siteName: null,
      };
      _cache.set(url, fallback);
      return fallback;
    });
  _inflight.set(url, promise);
  return promise;
}

export function useUnfurl(body: string): Unfurl[] {
  const [unfurls, setUnfurls] = useState<Unfurl[]>([]);
  useEffect(() => {
    const urls = extractUrls(body);
    if (urls.length === 0) {
      setUnfurls([]);
      return;
    }
    let cancelled = false;
    Promise.all(urls.map(fetchOne)).then((results) => {
      if (cancelled) return;
      setUnfurls(results);
    });
    return () => {
      cancelled = true;
    };
  }, [body]);
  return unfurls;
}

// Test-only: clear the module-level cache between cases.
export function __resetUnfurlCacheForTests(): void {
  _cache.clear();
  _inflight.clear();
}
