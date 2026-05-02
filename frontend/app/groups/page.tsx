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
        <span className="text-sm text-gray-500">Loading…</span>
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
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Join with code
          </Link>
          <Link
            href="/groups/new"
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white"
          >
            New group
          </Link>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-500">
          <p className="mb-4">You have not joined any groups yet.</p>
          <div className="flex justify-center gap-3">
            <Link
              href="/groups/new"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              Create a group
            </Link>
            <Link
              href="/join"
              className="rounded border border-gray-300 px-4 py-2 text-sm"
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
                className="flex items-center justify-between rounded border border-gray-200 p-4 hover:bg-gray-50"
              >
                <div>
                  <p className="font-medium">{group.name}</p>
                  {group.description && (
                    <p className="mt-0.5 text-sm text-gray-500 line-clamp-1">
                      {group.description}
                    </p>
                  )}
                </div>
                <span className="text-sm text-gray-400">
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
