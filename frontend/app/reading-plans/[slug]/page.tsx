"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { usePlanProgress, useReadingPlan } from "@/lib/hooks/useReadingPlans";

export default function ReadingPlanDetailPage() {
  const params = useParams();
  const slug = String(
    Array.isArray(params?.slug) ? params.slug[0] : (params?.slug ?? ""),
  );
  const { plan, loading } = useReadingPlan(slug);
  const { progress } = usePlanProgress(slug);

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

  const completed = new Set<number>(progress?.completedDays ?? []);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/reading-plans" className="text-xs text-gray-500">
        ← Reading plans
      </Link>
      <header className="mt-3">
        <h1 className="text-3xl font-semibold">{plan.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{plan.duration} days</p>
        <p className="mt-3 text-sm text-gray-700">{plan.description}</p>
        {progress && (progress.streak ?? 0) > 0 && (
          <p className="mt-3 text-sm text-amber-700">
            🔥 Current streak: {progress.streak} days
          </p>
        )}
      </header>

      <ol className="mt-6 space-y-2">
        {plan.days.map((d) => {
          const done = completed.has(d.dayNumber);
          return (
            <li
              key={d.dayNumber}
              className={`flex items-center justify-between rounded border px-4 py-3 ${
                done ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"
              }`}
            >
              <div>
                <p className="text-sm font-medium">
                  Day {d.dayNumber} — {d.scriptureRef}
                </p>
                <p className="text-xs text-gray-500">{d.prompt}</p>
              </div>
              <Link
                href={`/reading-plans/${plan.slug}/day/${d.dayNumber}`}
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >
                {done ? "Review" : "Open"}
              </Link>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
