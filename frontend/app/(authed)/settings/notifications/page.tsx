"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";

type Prefs = {
  mentions: boolean;
  replies: boolean;
  announcements: boolean;
  digest: boolean;
};

const DEFAULT_PREFS: Prefs = {
  mentions: true,
  replies: true,
  announcements: true,
  digest: true,
};

const LABELS: Record<keyof Prefs, { title: string; description: string }> = {
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
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const snap = await getDoc(
        doc(firestore, "users", user.uid, "notificationPrefs", "main"),
      );
      if (snap.exists()) {
        setPrefs({ ...DEFAULT_PREFS, ...(snap.data() as Partial<Prefs>) });
      }
      setLoading(false);
    })();
  }, [user]);

  const toggle = async (key: keyof Prefs) => {
    if (!user || saving) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    try {
      await setDoc(
        doc(firestore, "users", user.uid, "notificationPrefs", "main"),
        { ...next, schemaVersion: 1 },
        { merge: true },
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 text-sm text-gray-500">Loading…</div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Notification settings</h1>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {(Object.keys(LABELS) as (keyof Prefs)[]).map((key) => (
          <div key={key} className="flex items-start justify-between gap-4 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{LABELS[key].title}</p>
              <p className="text-xs text-gray-500">{LABELS[key].description}</p>
            </div>
            <button
              role="switch"
              aria-checked={prefs[key]}
              aria-label={LABELS[key].title}
              onClick={() => toggle(key)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
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

      <p className="mt-4 text-xs text-gray-500">
        Push notifications require browser permission. You can revoke access in your browser settings at any time.
      </p>
    </div>
  );
}
