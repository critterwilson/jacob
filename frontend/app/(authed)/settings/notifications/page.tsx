"use client";

import { Banner, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import {
  type NotificationPrefs,
  useNotificationPrefs,
} from "@/lib/hooks/useNotificationPrefs";

type PrefKey = keyof Omit<NotificationPrefs, "schemaVersion">;

const LABELS: Record<PrefKey, { title: string; description: string }> = {
  mentions: {
    title: "Mentions",
    description: "When someone @mentions you in a group or board.",
  },
  replies: {
    title: "Replies",
    description: "When someone replies in a thread you participated in.",
  },
  announcements: {
    title: "Announcements",
    description: "When a group leader posts an announcement.",
  },
  digest: {
    title: "Weekly digest email",
    description:
      "A weekly summary of activity in your groups, sent every Sunday.",
  },
  ministryFeed: {
    title: "Ministry feed posts",
    description:
      "When the ministry team broadcasts a new sermon, devotional, or announcement.",
  },
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const { prefs, loading, saving, error, setPref } = useNotificationPrefs(
    user?.uid,
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-5">
      <Heading level={1} size="md">
        Notification settings
      </Heading>

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
        {(Object.keys(LABELS) as PrefKey[]).map((key) => (
          <li
            key={key}
            className="flex items-start justify-between gap-4 px-4 py-4"
          >
            <div className="space-y-0.5">
              <p className="text-body font-medium text-cream">
                {LABELS[key].title}
              </p>
              <p className="text-body-sm text-cream-muted">
                {LABELS[key].description}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={prefs[key]}
              aria-label={LABELS[key].title}
              disabled={saving}
              onClick={() => setPref(key, !prefs[key])}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-fast focus:outline-none focus-visible:shadow-glow-gold disabled:opacity-50 ${
                prefs[key] ? "bg-gold" : "bg-ink-overlay"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-cream shadow ring-0 transition duration-200 ease-in-out ${
                  prefs[key] ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </li>
        ))}
      </ul>

      {error && <Banner tone="error">{error}</Banner>}

      <p className="text-caption text-cream-muted">
        Push notifications require browser permission. You can revoke access in
        your browser settings at any time.
      </p>
    </div>
  );
}
