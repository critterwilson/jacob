"use client";

import Link from "next/link";

import { Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";

// Phase 1 of the v2 redesign introduces an "Events" bottom tab (§4.2).
// This is a minimal "Upcoming events" surface so the tab has a real
// destination instead of a 404.
//
// The full Events screen — an aggregated upcoming/past list across all the
// user's groups with inline RSVP and a leader "+ New event" affordance
// (§5.5 / §5.6) — is Phase 2. Events today are group-scoped (useEvents
// takes a group id; there is no cross-group aggregation endpoint yet), so
// rather than fabricate a feed we surface a clean, honest entry point: a
// short explainer plus per-group links into each group's existing events
// surface. No backend work is introduced here.
export default function EventsPage() {
  const { user } = useAuth();
  const { groups, loading } = useGroups(user?.uid);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Eyebrow>What&apos;s coming up</Eyebrow>
        <Heading level={1} size="lg" className="normal-case">
          Events
        </Heading>
      </div>

      <div className="rounded-lg border border-dashed border-line bg-ink-raised px-4 py-8 text-center">
        <p className="text-body-sm text-cream-muted">
          Events from your groups will appear here.
        </p>
      </div>

      {!loading && groups.length > 0 && (
        <section className="mt-8 space-y-3" aria-labelledby="events-by-group">
          <Heading
            level={2}
            size="sm"
            id="events-by-group"
            className="normal-case text-cream-muted"
          >
            Browse a group&apos;s events
          </Heading>
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}/events`}
                  className="flex items-center justify-between rounded-lg border border-line bg-ink-raised px-4 py-3 no-underline transition-colors hover:border-line-strong hover:bg-ink-raised/80"
                >
                  <span className="text-body text-cream">{g.name}</span>
                  <span aria-hidden className="text-cream-muted">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
