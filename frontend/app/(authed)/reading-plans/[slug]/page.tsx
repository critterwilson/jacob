"use client";

import NextLink from "next/link";
import { useParams } from "next/navigation";

import { Eyebrow, Heading, Link, cn } from "@/components/ui";
import { usePlanProgress, useReadingPlan } from "@/lib/hooks/useReadingPlans";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

export default function ReadingPlanDetailPage() {
  const params = useParams();
  const slug = String(
    Array.isArray(params?.slug) ? params.slug[0] : (params?.slug ?? ""),
  );
  const { plan, loading } = useReadingPlan(slug);
  const { progress } = usePlanProgress(slug);
  const claims = useRoleClaims();

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
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

  const completed = new Set<number>(progress?.completedDays ?? []);
  const streak = progress?.streak ?? 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/reading-plans" variant="muted" className="text-caption">
          ← Reading plans
        </Link>
        {claims?.isAdmin && (
          <NextLink
            href={`/reading-plans/${plan.slug}/edit`}
            className={
              "rounded px-3 py-1 text-caption text-cream-muted border border-line " +
              "transition-colors hover:border-gold hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold"
            }
          >
            Edit
          </NextLink>
        )}
      </div>

      <header className="space-y-2">
        <Eyebrow>Reading plan</Eyebrow>
        <Heading level={1} size="lg">
          {plan.title}
        </Heading>
        <p className="text-caption text-cream-muted">{plan.duration} days</p>
        <p className="text-body text-cream-muted">{plan.description}</p>
        {streak > 0 && (
          <p className="inline-flex items-center gap-2 rounded-full border border-parchment-amber/40 bg-parchment-amber/10 px-3 py-1 text-caption font-medium text-parchment-amber">
            Current streak · {streak} {streak === 1 ? "day" : "days"}
          </p>
        )}
      </header>

      <ol className="space-y-2">
        {plan.days.map((d) => {
          const done = completed.has(d.dayNumber);
          return (
            <li key={d.dayNumber}>
              <NextLink
                href={`/reading-plans/${plan.slug}/day/${d.dayNumber}`}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-4 py-3 transition-colors duration-fast " +
                    "focus:outline-none focus-visible:shadow-glow-gold",
                  done
                    ? "border-sage/40 bg-sage/10 hover:bg-sage/15"
                    : "border-line bg-ink-raised hover:bg-ink-overlay",
                )}
              >
                <div className="space-y-0.5">
                  <p className="text-body text-cream">
                    Day {d.dayNumber} — {d.scriptureRef}
                  </p>
                  <p className="text-caption text-cream-muted">{d.prompt}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-caption",
                    done ? "text-sage" : "text-gold-soft",
                  )}
                >
                  {done ? "Review" : "Open →"}
                </span>
              </NextLink>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
