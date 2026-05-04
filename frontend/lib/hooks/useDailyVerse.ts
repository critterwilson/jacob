"use client";

import { useEffect, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";

export type DailyVerse = {
  reference: string;
  translation: "WEB" | "KJV";
  text: string;
  source: "bible-api.com" | "calendar-override";
};

type DailyVerseResponse = DailyVerse & { day: string };

export function useDailyVerse() {
  const [verse, setVerse] = useState<DailyVerse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();

    apiGet<DailyVerseResponse>("/api/daily-verse", { signal: ctrl.signal })
      .then((res) => {
        // Drop the server-only `day` field — components only consume the
        // verse content itself.
        const { day: _day, ...rest } = res;
        setVerse(rest);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          if (err.code === "aborted") return;
          // 404 = no verse published yet for today (Cloud Run job hasn't
          // run). Match the prior listener behaviour: render the placeholder.
          if (err.status !== 404) {
            console.warn("daily_verse_load_failed", err.code, err.status);
          }
        }
        setVerse(null);
        setLoading(false);
      });

    return () => ctrl.abort();
  }, []);

  return { verse, loading };
}
