"use client";

import { Card, Eyebrow, Scripture, Skeleton } from "@/components/ui";
import { useDailyVerse } from "@/lib/hooks/useDailyVerse";

export function DailyVerse() {
  const { verse, loading } = useDailyVerse();

  if (loading) {
    return (
      <Card surface="raised" className="space-y-3">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </Card>
    );
  }

  if (!verse) {
    return (
      <Card surface="raised">
        <p className="text-body-sm italic text-cream-dim">
          A new verse will appear shortly.
        </p>
      </Card>
    );
  }

  const searchRef = encodeURIComponent(verse.reference);
  const bibleUrl = `https://www.biblegateway.com/passage/?search=${searchRef}&version=${verse.translation}`;

  return (
    <Card surface="raised" className="space-y-3">
      <Eyebrow>Verse of the day</Eyebrow>
      <Scripture
        reference={verse.reference}
        translation={verse.translation}
        href={bibleUrl}
      >
        {verse.text}
      </Scripture>
    </Card>
  );
}
