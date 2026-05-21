"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";

export default function GroupsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { groups, loading: groupsLoading } = useGroups(user?.uid);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading || groupsLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your groups</h1>
        <div className="flex gap-3">
          <Link
            href="/join"
            className="rounded border border-line px-3 py-2 text-sm hover:bg-ink-raised"
          >
            Join with code
          </Link>
          <Link
            href="/groups/new"
            className="rounded bg-gold px-3 py-2 text-sm font-medium text-ink"
          >
            New group
          </Link>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded border border-dashed border-line p-8 text-center text-cream-muted">
          <p className="mb-4">You have not joined any groups yet.</p>
          <div className="flex justify-center gap-3">
            <Link
              href="/groups/new"
              className="rounded bg-gold px-4 py-2 text-sm font-medium text-ink"
            >
              Create a group
            </Link>
            <Link
              href="/join"
              className="rounded border border-line px-4 py-2 text-sm"
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
    </main>
  );
}
