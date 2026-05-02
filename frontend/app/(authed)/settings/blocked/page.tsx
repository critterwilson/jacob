"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { useBlocks } from "@/lib/hooks/useBlocks";

/**
 * /settings/blocked — list every user the viewer has blocked, with an
 * inline unblock control. The list is realtime — unblocking removes the
 * row immediately. Names aren't resolved here (we'd need to fetch each
 * user doc) — Phase 3 adds the displayName cache; today the row shows
 * the uid, which is sufficient for the rare unblock-by-mistake case.
 */
export default function BlockedSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const { blockedList, unblock, loading } = useBlocks();

  if (authLoading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="text-sm text-gray-500">Sign in to manage your blocks.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-4 text-2xl font-semibold">Blocked users</h1>
      <p className="mb-6 text-sm text-gray-600">
        You will not see messages from blocked users, and they will not be able
        to mention you. Blocking is one-directional — they can still see your
        messages.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading blocked users…</p>
      ) : blockedList.length === 0 ? (
        <p className="text-sm text-gray-500">You have not blocked anyone.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {blockedList.map((uid) => (
            <li
              key={uid}
              className="flex items-center justify-between px-4 py-3"
            >
              <code className="text-xs text-gray-700">{uid}</code>
              <button
                type="button"
                onClick={() => void unblock(uid)}
                className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-gray-400">
        <Link href="/home" className="text-blue-600 hover:underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
