"use client";

import Link from "next/link";

import { useReadingPlans } from "@/lib/hooks/useReadingPlans";

export default function ReadingPlansIndexPage() {
  const { plans, loading } = useReadingPlans();

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header>
        <h1 className="text-3xl font-semibold">Reading plans</h1>
        <p className="text-sm text-gray-500">
          Multi-day scripture journeys with a daily reflection prompt.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-gray-500">No reading plans yet.</p>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li
              key={p.slug}
              className="rounded border border-gray-200 bg-white p-4"
            >
              <Link
                href={`/reading-plans/${p.slug}`}
                className="text-lg font-medium text-blue-700 hover:underline"
              >
                {p.title}
              </Link>
              <p className="mt-1 text-xs text-gray-500">{p.duration} days</p>
              <p className="mt-2 text-sm text-gray-700">{p.description}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
