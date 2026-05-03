"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";

import { firestore } from "@/lib/firebase";

export type DailyVerse = {
  reference: string;
  translation: "WEB" | "KJV";
  text: string;
  source: "bible-api.com" | "calendar-override";
  fetchedAt: Timestamp;
};

export function useDailyVerse() {
  const [verse, setVerse] = useState<DailyVerse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    return onSnapshot(
      doc(firestore, "daily_verse", today),
      (snap) => {
        if (snap.exists()) {
          setVerse(snap.data() as DailyVerse);
        } else {
          setVerse(null);
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { verse, loading };
}
