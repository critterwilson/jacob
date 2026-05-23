"use client";

import { useCallback, useEffect, useState } from "react";

// Bump the suffix if tutorial content changes meaningfully and everyone
// should see the new version — existing devices will then re-trigger.
const STORAGE_KEY = "jacob-tutorial-completed-v1";

function hasSeenTutorial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private-mode Safari throws on localStorage access. Treat as "seen"
    // so we don't pop the overlay on every visit in that case.
    return true;
  }
}

function markSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Best-effort — see above.
  }
}

export type UseWelcomeTutorialResult = {
  open: boolean;
  openTutorial: () => void;
  closeTutorial: () => void;
};

/**
 * First-run tutorial controller.
 *
 * Auto-opens on mount the first time a user reaches a screen that calls
 * this hook (intended: the authed app shell), and remembers the dismissal
 * in localStorage. Callers can also re-open it on demand — that's what
 * the FAQ launcher does.
 */
export function useWelcomeTutorial(): UseWelcomeTutorialResult {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasSeenTutorial()) {
      setOpen(true);
    }
  }, []);

  const openTutorial = useCallback(() => setOpen(true), []);
  const closeTutorial = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  return { open, openTutorial, closeTutorial };
}

// Exposed so tests can clear / inspect persistence without hard-coding the key.
export const WELCOME_TUTORIAL_STORAGE_KEY = STORAGE_KEY;
