"use client";

import { useDailyVerse } from "@/lib/hooks/useDailyVerse";

export function DailyVerse() {
  const { verse, loading } = useDailyVerse();

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-4 animate-pulse">
        <div className="mb-2 h-4 w-1/3 rounded bg-gray-200" />
        <div className="h-3 w-full rounded bg-gray-200" />
        <div className="mt-1 h-3 w-4/5 rounded bg-gray-200" />
      </div>
    );
  }

  if (!verse) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-4 text-sm text-gray-500 italic">
        A new verse will appear shortly.
      </div>
    );
  }

  const searchRef = encodeURIComponent(verse.reference);
  const bibleUrl = `https://www.biblegateway.com/passage/?search=${searchRef}&version=${verse.translation}`;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-600">
        Verse of the day
      </p>
      <p className="text-sm italic text-gray-800">&ldquo;{verse.text}&rdquo;</p>
      <a
        href={bibleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs text-blue-600 hover:underline"
      >
        {verse.reference} ({verse.translation})
      </a>
    </div>
  );
}
