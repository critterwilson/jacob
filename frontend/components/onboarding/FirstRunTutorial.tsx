"use client";

import { WelcomeTutorial } from "@/components/onboarding/WelcomeTutorial";
import { useWelcomeTutorial } from "@/lib/hooks/useWelcomeTutorial";

/**
 * Self-contained first-run trigger mounted by the authed layout.
 *
 * On first authed page load it auto-opens the WelcomeTutorial; once
 * dismissed it stays closed (localStorage). The hook is initialised in
 * a child component so the layout itself can stay free of tutorial state.
 */
export function FirstRunTutorial() {
  const { open, closeTutorial } = useWelcomeTutorial();
  return <WelcomeTutorial open={open} onClose={closeTutorial} />;
}
