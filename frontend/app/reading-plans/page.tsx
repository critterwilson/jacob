"use client";

import { OpenBook } from "@/components/motifs/OpenBook";
import { Card, Eyebrow, Heading, Link } from "@/components/ui";
import { useReadingPlans } from "@/lib/hooks/useReadingPlans";

export default function ReadingPlansIndexPage() {
  const { plans, loading } = useReadingPlans();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="flex items-center gap-6">
        <OpenBook className="h-16 w-auto shrink-0 text-gold-soft opacity-90" />
        <div className="space-y-2">
          <Eyebrow>Multi-day</Eyebrow>
          <Heading level={1} size="md">
            Reading plans
          </Heading>
          <p className="text-body-sm text-cream-muted">
            Multi-day scripture journeys with a daily reflection prompt.
          </p>
        </div>
      </header>

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="text-body-sm text-cream-muted">No reading plans yet.</p>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/reading-plans/${p.slug}`}
                variant="muted"
                className="block rounded-lg no-underline hover:no-underline focus:outline-none focus-visible:shadow-glow-gold"
              >
                <Card surface="raised" interactive padding="md" className="space-y-2">
                  <h2 className="font-display text-display-sm text-cream">
                    {p.title}
                  </h2>
                  <p className="text-caption text-cream-dim">
                    {p.duration} days
                  </p>
                  <p className="text-body text-cream-muted">{p.description}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
