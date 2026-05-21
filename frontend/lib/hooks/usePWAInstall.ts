"use client";

import { useCallback, useEffect, useState } from "react";

const SNOOZE_KEY = "pwa-install-snoozed-until";
const PERMANENT_KEY = "pwa-install-dismissed";
const SNOOZE_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function usePWAInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Stable across the lifetime of the page — if you're in standalone you're in standalone.
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      !!(navigator as Navigator & { standalone?: boolean }).standalone);

  useEffect(() => {
    if (localStorage.getItem(PERMANENT_KEY) === "1") {
      setDismissed(true);
      return;
    }
    const snoozedUntil = localStorage.getItem(SNOOZE_KEY);
    if (snoozedUntil && Date.now() < Number(snoozedUntil)) {
      setDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "dismissed") {
      snooze();
      setDismissed(true);
    }
    setPromptEvent(null);
  }, [promptEvent]);

  const dismiss = useCallback(() => {
    snooze();
    setDismissed(true);
    setPromptEvent(null);
  }, []);

  const permanentDismiss = useCallback(() => {
    localStorage.setItem(PERMANENT_KEY, "1");
    setDismissed(true);
    setPromptEvent(null);
  }, []);

  return {
    canInstall: !!promptEvent && !dismissed,
    promptInstall,
    dismiss,
    permanentDismiss,
    dismissed,
    isStandalone,
  };
}

function snooze() {
  const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem(SNOOZE_KEY, String(until));
}
