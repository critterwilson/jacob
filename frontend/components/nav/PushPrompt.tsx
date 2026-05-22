"use client";

import { useState, useEffect } from "react";

import { Button } from "@/components/ui";
import { registerPushToken } from "@/lib/push";

const SNOOZE_KEY = "jacob_push_prompt_snoozed_until";
const SNOOZE_DAYS = 7;

type Props = { uid: string };

type Mode = "hidden" | "default" | "denied";

export function PushPrompt({ uid }: Props) {
  const [mode, setMode] = useState<Mode>("hidden");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    const snoozeUntil = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
    const snoozed = Date.now() < snoozeUntil;

    if (Notification.permission === "granted") {
      setMode("hidden");
      return;
    }
    if (Notification.permission === "denied") {
      if (snoozed) return;
      setMode("denied");
      return;
    }
    // "default"
    if (snoozed) return;
    setMode("default");
  }, []);

  if (mode === "hidden") return null;

  const snooze = () => {
    const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(SNOOZE_KEY, String(until));
    setMode("hidden");
  };

  const enable = async () => {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setMode("hidden");
      await registerPushToken(uid);
    } else if (permission === "denied") {
      setMode("denied");
    } else {
      // user dismissed without choosing — snooze so we don't immediately re-show
      snooze();
    }
  };

  const iosNote =
    typeof navigator !== "undefined" &&
    /iphone|ipad/i.test(navigator.userAgent) ? (
      <p className="mt-1 text-xs text-cream-muted">
        On iOS, push notifications require installing JACOB to your home screen
        (Safari → Share → Add to Home Screen).
      </p>
    ) : null;

  if (mode === "denied") {
    return (
      <div
        role="banner"
        aria-label="Push notifications are blocked"
        className="flex items-start gap-3 rounded-lg border border-line bg-ink-raised px-4 py-3 text-sm"
      >
        <span className="mt-0.5 shrink-0 text-gold">🔔</span>
        <div className="flex-1">
          <p className="font-medium text-cream">Notifications are blocked</p>
          <p className="text-cream-muted">
            You&apos;ve blocked notifications for JACOB. Re-enable them in your
            browser settings (click the lock icon in the address bar →
            Notifications → Allow) to get mentions, replies, and announcements.
          </p>
          {iosNote}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={snooze}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="banner"
      aria-label="Enable push notifications"
      className="flex items-start gap-3 rounded-lg border border-line bg-ink-raised px-4 py-3 text-sm"
    >
      <span className="mt-0.5 shrink-0 text-gold">🔔</span>
      <div className="flex-1">
        <p className="font-medium text-cream">Stay in the loop</p>
        <p className="text-cream-muted">
          Get notified about mentions, replies, and announcements in your
          groups.
        </p>
        {iosNote}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="primary" size="sm" onClick={enable}>
          Enable
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={snooze}>
          Not now
        </Button>
      </div>
    </div>
  );
}
