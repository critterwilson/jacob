"use client";

import { Avatar, Button, Heading, Link } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useBlocks } from "@/lib/hooks/useBlocks";

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
          {blockedList.map((entry) => (
            <li
              key={entry.uid}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  name={entry.displayName}
                  photoURL={entry.photoURL}
                  size="sm"
                />
                <span className="truncate text-body-sm text-cream">
                  {entry.displayName}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void unblock(entry.uid)}
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
