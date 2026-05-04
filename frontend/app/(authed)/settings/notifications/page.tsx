"use client";

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
    description: "A weekly summary of activity in your groups, sent every Sunday.",
  },
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const { prefs, loading, saving, error, setPref } = useNotificationPrefs(user?.uid);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 text-sm text-gray-500">Loading…</div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Notification settings</h1>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {(Object.keys(LABELS) as PrefKey[]).map((key) => (
          <div key={key} className="flex items-start justify-between gap-4 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{LABELS[key].title}</p>
              <p className="text-xs text-gray-500">{LABELS[key].description}</p>
            </div>
            <button
              role="switch"
              aria-checked={prefs[key]}
              aria-label={LABELS[key].title}
              disabled={saving}
              onClick={() => setPref(key, !prefs[key])}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
                prefs[key] ? "bg-blue-600" : "bg-gray-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  prefs[key] ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Push notifications require browser permission. You can revoke access in your browser settings at any time.
      </p>
    </div>
  );
}
