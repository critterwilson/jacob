"use client";

import Link from "next/link";

import { useDevotionals } from "@/lib/hooks/useDevotionals";

export default function DevotionalsIndexPage() {
  const { devotionals, loading } = useDevotionals();

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header>
        <h1 className="text-3xl font-semibold">Devotionals</h1>
        <p className="text-sm text-gray-500">
          Short reflections paired with scripture. Refreshed regularly.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : devotionals.length === 0 ? (
        <p className="text-sm text-gray-500">
          No devotionals published yet. Check back soon.
        </p>
      ) : (
        <ul className="space-y-3">
          {devotionals.map((d) => (
            <li
              key={d.slug}
              className="rounded border border-gray-200 bg-white p-4"
            >
              <Link
                href={`/devotionals/${d.slug}`}
                className="text-lg font-medium text-blue-700 hover:underline"
              >
                {d.title}
              </Link>
              <p className="mt-1 text-xs text-gray-500">{d.scriptureRef}</p>
              <p className="mt-2 text-sm text-gray-700">
                {d.body
                  .replace(/[*_#`]/g, "")
                  .split("\n")[0]
                  .slice(0, 160)}
                …
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
