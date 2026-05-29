"use client";

import Link from "next/link";

import { RecentActivity } from "@/components/home/RecentActivity";
import { WeeklySermon } from "@/components/home/WeeklySermon";
import { InstallPrompt } from "@/components/nav/InstallPrompt";
import { PushPrompt } from "@/components/nav/PushPrompt";
import { Banner, Heading, Link as UILink } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";
import { useMaintenanceBanner } from "@/lib/hooks/useMaintenanceBanner";
import { useMinistryOwner } from "@/lib/hooks/useMinistryOwner";
import { useRecentMessages } from "@/lib/hooks/useRecentMessages";
import { useWeeklySermon } from "@/lib/hooks/useWeeklySermon";

// Button-shaped <Link> classes for the no-groups empty state. Mirrors
// Button.tsx secondary at size=md so the CTA renders as an anchor
// (correct semantics for navigation).
const ctaSecondary =
  "inline-flex h-10 items-center justify-center rounded border border-line px-4 " +
  "font-sans text-label font-medium text-cream bg-transparent " +
  "hover:bg-ink-raised hover:border-line-strong " +
  "transition-colors duration-fast focus:outline-none focus-visible:shadow-glow-gold";

export default function HomePage() {
  const { user } = useAuth();
  const isOwner = useMinistryOwner();
  const { groups, loading: groupsLoading } = useGroups(user?.uid);
  const { messages: recentMessages, loading: recentLoading } =
    useRecentMessages(groups);
  const { maintenance } = useMaintenanceBanner();
  const { sermon, loading: sermonLoading } = useWeeklySermon();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-10">
      <h1 className="sr-only">Home</h1>

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

      {/* Surface 1 — the weekly sermon hero. */}
      <div className="space-y-2">
        <WeeklySermon sermon={sermon} loading={sermonLoading} />
        {isOwner === true && (
          <UILink
            href="/feed/weekly-sermon"
            variant="muted"
            className="text-body-sm"
          >
            {sermon ? "Update this week's sermon →" : "Post this week's sermon →"}
          </UILink>
        )}
      </div>

      {/* Surface 2 — recent chat activity across the user's groups. */}
      <section className="space-y-3" aria-labelledby="home-recent-heading">
        <Heading level={2} size="sm" id="home-recent-heading">
          Recent in your groups
        </Heading>

        {groupsLoading ? (
          <p className="text-body-sm text-cream-muted">Loading…</p>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-ink-raised px-4 py-8 text-center">
            <p className="mb-4 text-body-sm text-cream-muted">
              You haven&apos;t joined any groups yet. Find one to start the
              conversation.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/discover" className={ctaSecondary}>
                Discover groups
              </Link>
              <Link href="/join" className={ctaSecondary}>
                Join with code
              </Link>
            </div>
          </div>
        ) : (
          <RecentActivity messages={recentMessages} loading={recentLoading} />
        )}
      </section>
    </div>
  );
}
