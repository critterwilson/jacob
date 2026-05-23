"use client";

import { useCallback, useState } from "react";

import { WelcomeTutorial } from "@/components/onboarding/WelcomeTutorial";
import { Button } from "@/components/ui";
import { WELCOME_TUTORIAL_STORAGE_KEY } from "@/lib/hooks/useWelcomeTutorial";

/**
 * Re-openable entry to the welcome tutorial from the FAQ page. Marks
 * the tutorial as seen on close so an authed user who finds the
 * walkthrough here doesn't get auto-prompted again on /home.
 */
export function FaqTutorialLauncher() {
  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(WELCOME_TUTORIAL_STORAGE_KEY, "1");
    } catch {
      // Best-effort; matches useWelcomeTutorial.
    }
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="md"
        onClick={() => setOpen(true)}
      >
        Show the welcome tour
      </Button>
      <WelcomeTutorial open={open} onClose={handleClose} />
    </>
  );
}
