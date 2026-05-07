"use client";

import { Button, Heading, Link } from "@/components/ui";
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
    return (
      <p className="px-4 py-10 text-body-sm text-cream-muted">Loading…</p>
    );
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="text-body-sm text-cream-muted">
          Sign in to manage your blocks.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 px-4 py-10">
      <Heading level={1} size="md">
        Blocked users
      </Heading>
      <p className="text-body-sm text-cream-muted">
        You will not see messages from blocked users, and they will not be
        able to mention you. Blocking is one-directional — they can still see
        your messages.
      </p>

      {loading ? (
        <p className="text-body-sm text-cream-muted">
          Loading blocked users…
        </p>
      ) : blockedList.length === 0 ? (
        <p className="text-body-sm text-cream-muted">
          You have not blocked anyone.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
          {blockedList.map((uid) => (
            <li
              key={uid}
              className="flex items-center justify-between px-4 py-3"
            >
              <code className="font-mono text-caption text-cream">{uid}</code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void unblock(uid)}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-caption text-cream-muted">
        <Link href="/home" variant="muted">
          Back to home
        </Link>
      </p>
    </main>
  );
}
