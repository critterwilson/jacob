"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { WeeklySermon } from "@/components/home/WeeklySermon";
import { InstallPrompt } from "@/components/nav/InstallPrompt";
import { PushPrompt } from "@/components/nav/PushPrompt";
import { FloatingActionBar, Link as UILink } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";
import { useMinistryOwner } from "@/lib/hooks/useMinistryOwner";
import { useWeeklySermon } from "@/lib/hooks/useWeeklySermon";

export default function GroupsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { groups, loading: groupsLoading } = useGroups(user?.uid);
  const isOwner = useMinistryOwner();
  const { sermon, loading: sermonLoading } = useWeeklySermon();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading || groupsLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {/* Install + Push prompts. Both render null when already installed /
       * permitted / dismissed, so the wrapper collapses. They moved here
       * from /home (removed as a destination in the v2 redesign) so they
       * aren't lost — the Groups list is now where members land. */}
      <div className="mb-6 flex flex-col gap-2">
        <PushPrompt uid={user.uid} />
        <InstallPrompt />
      </div>

      {/* Weekly sermon hero — relocated from /home so the ministry owner
       * can still drop a weekly video and members still see it the moment
       * they open the app (PR #356). */}
      <div className="mb-8 space-y-2">
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-y-3">
        <h1 className="text-2xl font-semibold">Your groups</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/join"
            className="inline-flex h-11 items-center rounded border border-line px-4 text-body-sm transition-colors duration-fast hover:bg-ink-raised focus:outline-none focus-visible:shadow-glow-gold"
          >
            Join with code
          </Link>
          {/* Desktop keeps the inline primary; on mobile the persistent
           * FloatingActionBar (below) carries "New group" so it never
           * scrolls out of reach behind a long group list. */}
          <Link
            href="/groups/new"
            className="hidden h-11 items-center rounded bg-gold px-4 text-body-sm font-medium text-ink transition-colors duration-fast hover:bg-gold-soft focus:outline-none focus-visible:shadow-glow-gold md:inline-flex"
          >
            New group
          </Link>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded border border-dashed border-line p-8 text-center text-cream-muted">
          <p className="mb-4">You have not joined any groups yet.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/groups/new"
              className="inline-flex h-11 items-center rounded bg-gold px-4 text-body-sm font-medium text-ink transition-colors duration-fast hover:bg-gold-soft focus:outline-none focus-visible:shadow-glow-gold"
            >
              Create a group
            </Link>
            <Link
              href="/join"
              className="inline-flex h-11 items-center rounded border border-line px-4 text-body-sm transition-colors duration-fast hover:bg-ink-raised focus:outline-none focus-visible:shadow-glow-gold"
            >
              Join with code
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}`}
                className="flex items-center justify-between rounded border border-line p-4 hover:bg-ink-raised"
              >
                <div>
                  <p className="font-medium">{group.name}</p>
                  {group.description && (
                    <p className="mt-0.5 text-sm text-cream-muted line-clamp-1">
                      {group.description}
                    </p>
                  )}
                </div>
                <span className="text-sm text-cream-muted">
                  {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Mobile-only persistent primary action. The empty state already
       * surfaces a centered "Create a group" CTA on a short, non-scrolling
       * page, so the bar is only needed once the (scrollable) list exists. */}
      {groups.length > 0 && (
        <FloatingActionBar label="New group" href="/groups/new" />
      )}
    </main>
  );
}
