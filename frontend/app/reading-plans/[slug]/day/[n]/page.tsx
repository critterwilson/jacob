"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { usePlanProgress, useReadingPlan } from "@/lib/hooks/useReadingPlans";

export default function ReadingPlanDayPage() {
  const params = useParams();
  const slug = String(
    Array.isArray(params?.slug) ? params.slug[0] : (params?.slug ?? ""),
  );
  const dayNumber = Number(
    Array.isArray(params?.n) ? params.n[0] : (params?.n ?? "0"),
  );
  const { plan, loading } = useReadingPlan(slug);
  const { progress, markComplete } = usePlanProgress(slug);
  const [pending, setPending] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link href="/reading-plans" className="text-xs text-gray-500">
          ← Reading plans
        </Link>
        <p className="mt-4 text-sm text-gray-700">Plan not found.</p>
      </div>
    );
  }
  const day = plan.days.find((d) => d.dayNumber === dayNumber);
  if (!day) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link href={`/reading-plans/${slug}`} className="text-xs text-gray-500">
          ← Plan
        </Link>
        <p className="mt-4 text-sm text-gray-700">Day not found.</p>
      </div>
    );
  }

  const done = (progress?.completedDays ?? []).includes(dayNumber);
  const next = plan.days.find((d) => d.dayNumber === dayNumber + 1);
  const prev = plan.days.find((d) => d.dayNumber === dayNumber - 1);

  const handleMark = async () => {
    setPending(true);
    try {
      await markComplete(dayNumber);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href={`/reading-plans/${slug}`} className="text-xs text-gray-500">
        ← {plan.title}
      </Link>
      <header className="mt-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Day {dayNumber} of {plan.duration}
        </p>
        <h1 className="text-2xl font-semibold">{day.scriptureRef}</h1>
      </header>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Reflection prompt
        </p>
        <p className="mt-2 text-sm text-gray-800">{day.prompt}</p>
      </section>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={handleMark}
          disabled={pending}
          className={`rounded px-3 py-1 text-sm text-white disabled:opacity-40 ${
            done ? "bg-green-700" : "bg-blue-600"
          }`}
        >
          {pending ? "Saving…" : done ? "Marked complete ✓" : "Mark complete"}
        </button>
        <div className="flex gap-2 text-xs">
          {prev && (
            <Link
              href={`/reading-plans/${slug}/day/${prev.dayNumber}`}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
            >
              ← Day {prev.dayNumber}
            </Link>
          )}
          {next && (
            <Link
              href={`/reading-plans/${slug}/day/${next.dayNumber}`}
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
            >
              Day {next.dayNumber} →
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
