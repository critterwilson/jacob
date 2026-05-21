"use client";

import Link from "next/link";

import { DailyVerse } from "@/components/home/DailyVerse";
import { RecentActivity } from "@/components/home/RecentActivity";
import { InstallPrompt } from "@/components/nav/InstallPrompt";
import { PushPrompt } from "@/components/nav/PushPrompt";
import { Banner, Heading, Link as UILink } from "@/components/ui";

// Button-shaped <Link> classes. Mirrors Button.tsx primary/secondary
// at size=md so empty-state CTAs render as anchors (correct semantics
// for navigation) without a Button-as-link polymorphic refactor.
const ctaPrimary =
  "inline-flex h-10 items-center justify-center rounded px-4 font-sans " +
  "text-label font-medium bg-gold text-ink hover:bg-gold-soft active:bg-gold-deep " +
  "transition-colors duration-fast focus:outline-none focus-visible:shadow-glow-gold";

const ctaSecondary =
  "inline-flex h-10 items-center justify-center rounded border border-line px-4 " +
  "font-sans text-label font-medium text-cream bg-transparent " +
  "hover:bg-ink-raised hover:border-line-strong " +
  "transition-colors duration-fast focus:outline-none focus-visible:shadow-glow-gold";
import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";
import { useMaintenanceBanner } from "@/lib/hooks/useMaintenanceBanner";
import { useRecentMessages } from "@/lib/hooks/useRecentMessages";

export default function HomePage() {
  const { user } = useAuth();
  const { groups, loading: groupsLoading } = useGroups(user?.uid);
  const { messages: recentMessages, loading: recentLoading } =
    useRecentMessages(groups);
  const { maintenance } = useMaintenanceBanner();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-10">
      {maintenance && (
        // role="alert" overrides Banner's default warning -> status, since
        // a live maintenance notice should announce assertively.
        <Banner tone="warning" role="alert" title="Maintenance in progress">
          JACOB is currently undergoing maintenance. Some features may be
          temporarily unavailable.
        </Banner>
      )}

      {/* Install + Push prompts live on /home only. Both render null when
       * already installed / permitted / dismissed, so the flex gap collapses. */}
      {user && (
        <div className="flex flex-col gap-2">
          <PushPrompt uid={user.uid} />
          <InstallPrompt />
        </div>
      )}

      <Heading level={1} size="md">
        Welcome{user?.displayName ? `, ${user.displayName}` : ""}
      </Heading>

      <section>
        <DailyVerse />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Heading level={2} size="sm">
            Your groups
          </Heading>
          <UILink href="/groups" variant="muted" className="text-body-sm">
            See all
          </UILink>
        </div>

        {groupsLoading ? (
          <p className="text-body-sm text-cream-muted">Loading groups…</p>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-ink-raised px-4 py-8 text-center">
            <p className="mb-4 text-body-sm text-cream-muted">
              You haven&apos;t joined any groups yet.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/groups/new" className={ctaPrimary}>
                Create a group
              </Link>
              <Link href="/join" className={ctaSecondary}>
                Join with code
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
            {groups.slice(0, 5).map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}/chat`}
                  className="flex items-center justify-between px-4 py-3 transition-colors duration-fast hover:bg-ink-overlay focus:outline-none focus-visible:bg-ink-overlay focus-visible:shadow-glow-gold"
                >
                  <span className="text-body text-cream">{group.name}</span>
                  <span className="text-caption text-cream-muted">
                    {group.memberCount}{" "}
                    {group.memberCount === 1 ? "member" : "members"}
                  </span>
                </Link>
              </li>
            ))}
            {groups.length > 5 && (
              <li>
                <UILink
                  href="/groups"
                  variant="muted"
                  className="block px-4 py-3 text-body-sm"
                >
                  +{groups.length - 5} more groups
                </UILink>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <Heading level={2} size="sm">
          Recent in your groups
        </Heading>
        <RecentActivity messages={recentMessages} loading={recentLoading} />
      </section>
    </div>
  );
}
