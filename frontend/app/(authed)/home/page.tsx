"use client";

import Link from "next/link";

import { ContinueReadingPlan } from "@/components/home/ContinueReadingPlan";
import { MinistryHighlights } from "@/components/home/MinistryHighlights";
import { RecentActivity } from "@/components/home/RecentActivity";
import { TodayDevotional } from "@/components/home/TodayDevotional";
import { InstallPrompt } from "@/components/nav/InstallPrompt";
import { PushPrompt } from "@/components/nav/PushPrompt";
import { Banner, Heading, Link as UILink } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useDevotionals } from "@/lib/hooks/useDevotionals";
import { useGroups } from "@/lib/hooks/useGroups";
import { useMaintenanceBanner } from "@/lib/hooks/useMaintenanceBanner";
import { useMinistryFeed } from "@/lib/hooks/useMinistryFeed";
import { useReadingPlanToday } from "@/lib/hooks/useReadingPlans";
import { useRecentMessages } from "@/lib/hooks/useRecentMessages";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

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

export default function HomePage() {
  const { user } = useAuth();
  const claims = useRoleClaims();
  // ADR 0015: only owners/admins can create groups directly. Everyone
  // else applies via the leader-application flow.
  const canCreateDirectly =
    !!claims && (claims.isAdmin || claims.isMinistryOwner);
  const createGroupHref = canCreateDirectly
    ? "/groups/new"
    : "/leader-application";
  const createGroupLabel = canCreateDirectly
    ? "Create a group"
    : "Apply to lead a group";
  const { groups, loading: groupsLoading } = useGroups(user?.uid);
  const { messages: recentMessages, loading: recentLoading } =
    useRecentMessages(groups);
  const { maintenance } = useMaintenanceBanner();
  const { data: planToday, loading: planLoading } = useReadingPlanToday();
  const { devotionals, loading: devotionalsLoading } = useDevotionals();
  const { posts: ministryPosts, loading: ministryLoading } = useMinistryFeed();

  const topDevotional = devotionals[0] ?? null;

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

      {/* Section 2 — Continue reading plan. Sequential + has a streak,
       *  so it's the highest-action surface on the page. */}
      <section aria-labelledby="home-plan-heading">
        <h2 id="home-plan-heading" className="sr-only">
          Reading plan
        </h2>
        <ContinueReadingPlan data={planToday} loading={planLoading} />
      </section>

      {/* Section 3 — Today's devotional. */}
      <section aria-labelledby="home-devotional-heading">
        <h2 id="home-devotional-heading" className="sr-only">
          Today&apos;s devotional
        </h2>
        <TodayDevotional
          devotional={topDevotional}
          loading={devotionalsLoading}
        />
      </section>

      {/* Section 4 — Your groups. Groups are the daily reality of the
       *  ministry, so they lead the surface ahead of organization
       *  content. */}
      <section className="space-y-3" aria-labelledby="home-groups-heading">
        <div className="flex items-baseline justify-between">
          <Heading level={2} size="sm" id="home-groups-heading">
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
              You haven&apos;t joined any groups yet. You can request to join
              an existing one or apply to lead a new group.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/discover" className={ctaPrimary}>
                Discover groups
              </Link>
              <Link href={createGroupHref} className={ctaSecondary}>
                {createGroupLabel}
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

      {/* Section 5 — Recent activity across the user's groups. */}
      <section className="space-y-3" aria-labelledby="home-recent-heading">
        <Heading level={2} size="sm" id="home-recent-heading">
          Recent in your groups
        </Heading>
        <RecentActivity messages={recentMessages} loading={recentLoading} />
      </section>

      {/* Section 6 — From your organization. The org tier is mostly
       *  future structure for now, so it sits below the user's groups
       *  and recent group activity. */}
      <section className="space-y-3" aria-labelledby="home-ministry-heading">
        <div className="flex items-baseline justify-between">
          <Heading level={2} size="sm" id="home-ministry-heading">
            From your organization
          </Heading>
          <UILink href="/feed" variant="muted" className="text-body-sm">
            See all
          </UILink>
        </div>
        <MinistryHighlights posts={ministryPosts} loading={ministryLoading} />
      </section>

      {/* Section 7 — Browse (existing). Leaves a way out to the rest
       * of the library when none of the above is what they want. */}
      <section className="space-y-3" aria-labelledby="home-browse-heading">
        <Heading level={2} size="sm" id="home-browse-heading">
          Browse
        </Heading>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <li>
            <UILink
              href="/devotionals"
              variant="muted"
              className="block rounded-lg border border-line bg-ink-raised px-4 py-3 text-body no-underline transition-colors duration-fast hover:bg-ink-overlay focus:outline-none focus-visible:shadow-glow-gold"
            >
              <span className="block text-body text-cream">Devotionals</span>
              <span className="block text-caption text-cream-muted">
                Short scripture reflections
              </span>
            </UILink>
          </li>
          <li>
            <UILink
              href="/reading-plans"
              variant="muted"
              className="block rounded-lg border border-line bg-ink-raised px-4 py-3 text-body no-underline transition-colors duration-fast hover:bg-ink-overlay focus:outline-none focus-visible:shadow-glow-gold"
            >
              <span className="block text-body text-cream">Reading plans</span>
              <span className="block text-caption text-cream-muted">
                Multi-day scripture journeys
              </span>
            </UILink>
          </li>
          <li>
            <UILink
              href="/discover"
              variant="muted"
              className="block rounded-lg border border-line bg-ink-raised px-4 py-3 text-body no-underline transition-colors duration-fast hover:bg-ink-overlay focus:outline-none focus-visible:shadow-glow-gold"
            >
              <span className="block text-body text-cream">Discover groups</span>
              <span className="block text-caption text-cream-muted">
                Find a public small group
              </span>
            </UILink>
          </li>
        </ul>
      </section>
    </div>
  );
}
