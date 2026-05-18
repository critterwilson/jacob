"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPut } from "@/lib/api";

// Mirrors `backend/app/models/users.py:NotificationPrefs`. Defaults
// match the prior Firestore-rules-side defaults so an unset doc still
// renders the toggles as "on" — except `ministryFeed` (ADR 0011)
// which defaults to OFF (opt-in for the brand-new broadcast channel).
export type NotificationPrefs = {
  mentions: boolean;
  replies: boolean;
  announcements: boolean;
  digest: boolean;
  ministryFeed: boolean;
  schemaVersion: number;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  mentions: true,
  replies: true,
  announcements: true,
  digest: true,
  ministryFeed: false,
  schemaVersion: 1,
};

export type UseNotificationPrefsResult = {
  prefs: NotificationPrefs;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setPref: (key: keyof Omit<NotificationPrefs, "schemaVersion">, value: boolean) => Promise<void>;
};

/**
 * Replaces the inline `getDoc`/`setDoc` block in
 * `app/(authed)/settings/notifications/page.tsx`. Reads via
 * `GET /api/users/me/notification-prefs`; mutations PUT the full doc
 * (the rule allowed full overwrites of these specific keys, and the
 * backend mirrors that).
 */
export function useNotificationPrefs(uid: string | undefined): UseNotificationPrefsResult {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiGet<NotificationPrefs>("/api/users/me/notification-prefs")
      .then((res) => {
        if (cancelled) return;
        setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...res });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code !== "aborted") {
          console.warn("notification_prefs_load_failed", err.code, err.status);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const setPref = useCallback(
    async (key: keyof Omit<NotificationPrefs, "schemaVersion">, value: boolean) => {
      const next = { ...prefs, [key]: value };
      setPrefs(next);
      setSaving(true);
      setError(null);
      try {
        const stored = await apiPut<NotificationPrefs, NotificationPrefs>(
          "/api/users/me/notification-prefs",
          next,
        );
        setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...stored });
      } catch (err) {
        // Roll the optimistic toggle back so the UI matches state again.
        setPrefs(prefs);
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not save preferences. Please try again.");
        }
      } finally {
        setSaving(false);
      }
    },
    [prefs],
  );

  return { prefs, loading, saving, error, setPref };
}
