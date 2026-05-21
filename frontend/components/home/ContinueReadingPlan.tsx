"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, Eyebrow, Heading, Skeleton } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import type { ActivePlanToday } from "@/lib/hooks/useReadingPlans";

type Props = {
  data: ActivePlanToday | null;
  loading: boolean;
};

export function ContinueReadingPlan({ data, loading }: Props) {
  const [marked, setMarked] = useState(false);
  const [marking, setMarking] = useState(false);

  if (loading) {
    return (
      <Card surface="raised" className="space-y-3">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
      </Card>
    );
  }

  // No plan started yet — render the prompt to start one.
  if (!data?.plan) {
    return (
      <Card surface="raised" className="space-y-3">
        <Eyebrow>Reading plan</Eyebrow>
        <p className="text-body-sm text-cream-muted">
          You haven&apos;t started a reading plan yet. Multi-day journeys
          through scripture with a daily reflection prompt.
        </p>
        <div>
          <Link
            href="/reading-plans"
            className={
              "inline-flex h-10 items-center justify-center rounded px-4 font-sans " +
              "text-label font-medium bg-gold text-ink hover:bg-gold-soft active:bg-gold-deep " +
              "transition-colors duration-fast focus:outline-none focus-visible:shadow-glow-gold"
            }
          >
            Browse reading plans
          </Link>
        </div>
      </Card>
    );
  }

  const { plan, nextDay, completedDays, streak, allDaysComplete } = data;
  const totalDays = plan.duration || 1;
  const completedCount = completedDays.length;
  const progressPct = Math.min(
    100,
    Math.round((completedCount / totalDays) * 100),
  );

  // Loop closed — celebrate, link back to the plan overview.
  if (allDaysComplete || !nextDay) {
    return (
      <Card surface="raised" className="space-y-3">
        <Eyebrow>Reading plan complete</Eyebrow>
        <Heading level={2} size="sm">
          {plan.title}
        </Heading>
        <p className="text-body-sm text-cream-muted">
          You&apos;ve finished every day of this plan. Well done.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/reading-plans/${plan.slug}`}
            className="text-body-sm text-gold-soft hover:text-gold underline-offset-4 hover:underline"
          >
            Revisit this plan
          </Link>
          <Link
            href="/reading-plans"
            className="text-body-sm text-gold-soft hover:text-gold underline-offset-4 hover:underline"
          >
            Find another →
          </Link>
        </div>
      </Card>
    );
  }

  const doneToday = marked;

  async function handleMark() {
    if (!nextDay || marking || doneToday) return;
    setMarking(true);
    try {
      await apiPost(`/api/reading-plans/${plan.slug}/progress/mark`, {
        dayNumber: nextDay.dayNumber,
      });
      setMarked(true);
    } catch (err) {
      if (err instanceof ApiError) {
        console.warn("plan_mark_failed", err.code, err.status);
      }
    } finally {
      setMarking(false);
    }
  }

  return (
    <Card surface="raised" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Continue reading plan</Eyebrow>
        {streak > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-parchment-amber/40 bg-parchment-amber/10 px-2.5 py-0.5 text-caption font-medium text-parchment-amber">
            {streak} day streak
          </span>
        )}
      </div>

      <div className="space-y-1">
        <Heading level={2} size="sm">
          {plan.title}
        </Heading>
        <p className="text-caption text-cream-muted">
          Day {nextDay.dayNumber} of {totalDays} · {nextDay.scriptureRef}
        </p>
      </div>

      <p className="text-body text-cream">{nextDay.prompt}</p>

      {/* Progress bar — purely cosmetic; main signal is the day count above. */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-overlay"
        aria-hidden
      >
        <div
          className="h-full bg-gold-soft transition-all duration-base"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link
          href={`/reading-plans/${plan.slug}/day/${nextDay.dayNumber}`}
          className={
            "inline-flex h-10 items-center justify-center rounded px-4 font-sans " +
            "text-label font-medium bg-gold text-ink hover:bg-gold-soft active:bg-gold-deep " +
            "transition-colors duration-fast focus:outline-none focus-visible:shadow-glow-gold"
          }
        >
          Open day {nextDay.dayNumber}
        </Link>
        <Button
          variant="secondary"
          size="md"
          onClick={handleMark}
          disabled={marking || doneToday}
          aria-live="polite"
        >
          {doneToday ? "Marked complete" : marking ? "Marking…" : "Mark complete"}
        </Button>
      </div>
    </Card>
  );
}
