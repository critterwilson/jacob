"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

import { Button, Card, Eyebrow, Heading, Link } from "@/components/ui";
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
      <div className="flex min-h-screen items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <Link href="/reading-plans" variant="muted" className="text-caption">
          ← Reading plans
        </Link>
        <p className="text-body-sm text-cream">Plan not found.</p>
      </div>
    );
  }
  const day = plan.days.find((d) => d.dayNumber === dayNumber);
  if (!day) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <Link
          href={`/reading-plans/${slug}`}
          variant="muted"
          className="text-caption"
        >
          ← Plan
        </Link>
        <p className="text-body-sm text-cream">Day not found.</p>
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
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link
        href={`/reading-plans/${slug}`}
        variant="muted"
        className="text-caption"
      >
        ← {plan.title}
      </Link>

      <header className="space-y-2">
        <Eyebrow>
          Day {dayNumber} of {plan.duration}
        </Eyebrow>
        <Heading level={1} size="lg">
          {day.scriptureRef}
        </Heading>
      </header>

      <Card surface="raised" padding="md" className="space-y-2">
        <Eyebrow>Reflection prompt</Eyebrow>
        <p className="text-body-lg leading-relaxed text-cream">{day.prompt}</p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant={done ? "secondary" : "primary"}
          size="md"
          onClick={() => void handleMark()}
          loading={pending}
          disabled={pending}
        >
          {pending
            ? "Saving…"
            : done
              ? "Marked complete ✓"
              : "Mark complete"}
        </Button>
        <div className="flex gap-2 text-caption">
          {prev && (
            <Link
              href={`/reading-plans/${slug}/day/${prev.dayNumber}`}
              variant="muted"
              className="rounded border border-line px-3 py-1 hover:bg-ink-raised hover:no-underline"
            >
              ← Day {prev.dayNumber}
            </Link>
          )}
          {next && (
            <Link
              href={`/reading-plans/${slug}/day/${next.dayNumber}`}
              variant="muted"
              className="rounded border border-line px-3 py-1 hover:bg-ink-raised hover:no-underline"
            >
              Day {next.dayNumber} →
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
