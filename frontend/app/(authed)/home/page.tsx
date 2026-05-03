"use client";

import Link from "next/link";
import { DailyVerse } from "@/components/home/DailyVerse";
import { RecentActivity } from "@/components/home/RecentActivity";
import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";
import { useMaintenanceBanner } from "@/lib/hooks/useMaintenanceBanner";
import { useRecentMessages } from "@/lib/hooks/useRecentMessages";

export default function HomePage() {
  const { user } = useAuth();
  const { groups, loading: groupsLoading } = useGroups(user?.uid);
  const { messages: recentMessages, loading: recentLoading } = useRecentMessages(groups);
  const { maintenance } = useMaintenanceBanner();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {maintenance && (
        <div
          role="alert"
          className="mb-6 rounded-md bg-yellow-50 px-4 py-3 text-sm text-yellow-800 border border-yellow-200"
        >
          🔧 JACOB is currently undergoing maintenance. Some features may be temporarily
          unavailable.
        </div>
      )}

      <h1 className="mb-6 text-2xl font-semibold">
        Welcome{user?.displayName ? `, ${user.displayName}` : ""}
      </h1>

      <section className="mb-6">
        <DailyVerse />
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Your groups</h2>
          <Link href="/groups" className="text-sm text-blue-600 hover:underline">
            See all
          </Link>
        </div>

        {groupsLoading ? (
          <p className="text-sm text-gray-500">Loading groups…</p>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
            <p className="mb-3">You haven&apos;t joined any groups yet.</p>
            <div className="flex justify-center gap-3">
              <Link
                href="/groups/new"
                className="rounded bg-blue-600 px-3 py-1.5 text-white"
              >
                Create a group
              </Link>
              <Link
                href="/join"
                className="rounded border border-gray-300 px-3 py-1.5"
              >
                Join with code
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {groups.slice(0, 5).map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}/chat`}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50"
                >
                  <span className="font-medium text-sm">{group.name}</span>
                  <span className="text-xs text-gray-400">
                    {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                  </span>
                </Link>
              </li>
            ))}
            {groups.length > 5 && (
              <li>
                <Link href="/groups" className="text-sm text-blue-600 hover:underline">
                  +{groups.length - 5} more groups
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Recent in your groups
        </h2>
        <RecentActivity messages={recentMessages} loading={recentLoading} />
      </section>
    </div>
  );
}
