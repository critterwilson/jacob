"use client";

import NextLink from "next/link";

import { OpenBook } from "@/components/motifs/OpenBook";
import { Button, Card, Eyebrow, Heading, Link } from "@/components/ui";
import { useReadingPlans } from "@/lib/hooks/useReadingPlans";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

export default function ReadingPlansIndexPage() {
  const { plans, loading } = useReadingPlans();
  const claims = useRoleClaims();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="flex items-center gap-6">
        <OpenBook className="h-16 w-auto shrink-0 text-gold-soft opacity-90" />
        <div className="flex-1 space-y-2">
          <Eyebrow>Multi-day</Eyebrow>
          <Heading level={1} size="md">
            Reading plans
          </Heading>
          <p className="text-body-sm text-cream-muted">
            Multi-day scripture journeys with a daily reflection prompt.
          </p>
        </div>
        {claims?.isAdmin && (
          <NextLink href="/reading-plans/new" tabIndex={-1}>
            <Button type="button" variant="primary" size="md">
              New plan
            </Button>
          </NextLink>
        )}
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
                  <p className="text-caption text-cream-muted">
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
