"use client";

import { OpenBook } from "@/components/motifs/OpenBook";
import {
  ButtonLink,
  Card,
  Eyebrow,
  FloatingActionBar,
  Heading,
  Link,
} from "@/components/ui";
import { useDevotionals } from "@/lib/hooks/useDevotionals";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

export default function DevotionalsIndexPage() {
  const { devotionals, loading } = useDevotionals();
  const claims = useRoleClaims();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="flex items-center gap-6">
        <OpenBook className="h-16 w-auto shrink-0 text-gold-soft opacity-90" />
        <div className="flex-1 space-y-2">
          <Eyebrow>Daily reading</Eyebrow>
          <Heading level={1} size="md">
            Devotionals
          </Heading>
          <p className="text-body-sm text-cream-muted">
            Short reflections paired with scripture. Refreshed regularly.
          </p>
        </div>
        {/* Desktop CTA; mobile uses the FloatingActionBar below. */}
        {claims?.isMinistryOwner && (
          <ButtonLink
            href="/devotionals/new"
            variant="primary"
            className="hidden md:inline-flex"
          >
            Write devotional
          </ButtonLink>
        )}
      </header>

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading…</p>
      ) : devotionals.length === 0 ? (
        <p className="text-body-sm text-cream-muted">
          No devotionals published yet. Check back soon.
        </p>
      ) : (
        <ul className="space-y-3">
          {devotionals.map((d) => (
            <li key={d.path}>
              <Link
                href={`/devotionals/${d.path}`}
                variant="muted"
                className="block rounded-lg no-underline hover:no-underline focus:outline-none focus-visible:shadow-glow-gold"
              >
                <Card surface="raised" interactive padding="md" className="space-y-2">
                  {d.groupId && d.groupName && (
                    // Pill label so readers see at a glance which group
                    // authored this devotional vs. platform-wide entries
                    // that have no label.
                    <p
                      className="inline-block rounded-full bg-ink-overlay px-2 py-0.5 text-eyebrow uppercase tracking-wider text-cream-muted"
                      aria-label={`From ${d.groupName}`}
                    >
                      {d.groupName}
                    </p>
                  )}
                  <h2 className="font-display text-display-sm text-cream">
                    {d.title}
                  </h2>
                  <p className="text-caption text-gold-soft">{d.scriptureRef}</p>
                  <p className="text-body text-cream-muted">
                    {d.body
                      .replace(/[*_#`]/g, "")
                      .split("\n")[0]
                      .slice(0, 160)}
                    …
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {claims?.isMinistryOwner && (
        <FloatingActionBar label="Write devotional" href="/devotionals/new" />
      )}
    </main>
  );
}
