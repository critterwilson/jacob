"use client";

import { useState, useEffect } from "react";
import { registerPushToken } from "@/lib/push";

const SNOOZE_KEY = "jacob_push_prompt_snoozed_until";
const SNOOZE_DAYS = 7;

type Props = { uid: string };

export function PushPrompt({ uid }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    const snoozeUntil = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
    if (Date.now() < snoozeUntil) return;

    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(SNOOZE_KEY, String(until));
    setVisible(false);
  };

  const enable = async () => {
    setVisible(false);
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await registerPushToken(uid);
    } else {
      dismiss();
    }
  };

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
          Get notified about mentions, replies, and announcements in your groups.
        </p>
        {/* iOS PWA note */}
        {typeof navigator !== "undefined" &&
          /iphone|ipad/i.test(navigator.userAgent) && (
            <p className="mt-1 text-xs text-cream-muted">
              On iOS, push notifications require installing JACOB to your home screen (Safari → Share → Add to Home Screen).
            </p>
          )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={enable}
          className="rounded bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold-soft"
        >
          Enable
        </button>
        <button
          onClick={dismiss}
          className="rounded border border-line px-3 py-1.5 text-xs text-cream hover:bg-ink-overlay"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
