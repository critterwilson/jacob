"use client";

import { useEffect, useRef, useState } from "react";

import { useScrollDirection } from "@/lib/hooks/useScrollDirection";

import { Button } from "./Button";
import { ButtonLink } from "./ButtonLink";
import { cn } from "./cn";

type FloatingActionBarProps = {
  /** Button text — the surface's one primary action, e.g. "New post". */
  label: string;
  /**
   * Navigational action: renders an anchor to this route. Use either
   * `href` or `onClick` — `href` wins if both are passed.
   */
  href?: string;
  /** Imperative action (open an inline form, etc.): renders a button. */
  onClick?: () => void;
};

/** Walks up from `el` to the nearest scrollable ancestor (overflow auto|scroll). */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * A mobile-only, near-full-width primary action anchored just above the
 * bottom tab bar. It is a page's one `primary` CTA (docs/design-system.md
 * §9), simply relocated — so a page that renders this should not also show
 * an inline primary button for the same action on mobile. Desktop has no
 * tab bar: the component is `md:hidden` and pages keep their inline button.
 *
 * Scroll behaviour: visible at rest and when scrolling up, slides + fades
 * out of the way when scrolling down, and is always visible near the top
 * of the page. See `useScrollDirection` for the jitter handling.
 */
export function FloatingActionBar({
  label,
  href,
  onClick,
}: FloatingActionBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTarget, setScrollTarget] = useState<
    HTMLElement | Window | null
  >(null);

  // The bar is `position: fixed`, but its DOM parent is still the page
  // content inside AppShell's scrolling <main>. Resolve that scroll
  // container once mounted; fall back to the window if there isn't one.
  useEffect(() => {
    setScrollTarget(findScrollParent(ref.current) ?? window);
  }, []);

  const { direction, atTop } = useScrollDirection(scrollTarget);
  const visible = atTop || direction === "up";

  const action = href ? (
    <ButtonLink
      href={href}
      variant="primary"
      size="md"
      fullWidth
      tabIndex={visible ? undefined : -1}
      className="shadow-raise"
    >
      {label}
    </ButtonLink>
  ) : (
    <Button
      variant="primary"
      size="md"
      fullWidth
      onClick={onClick}
      tabIndex={visible ? undefined : -1}
      className="shadow-raise"
    >
      {label}
    </Button>
  );

  return (
    <div
      ref={ref}
      data-testid="floating-action-bar"
      aria-hidden={!visible}
      className={cn(
        // Mobile-only; desktop keeps the page's inline CTA.
        "fixed inset-x-4 z-30 md:hidden",
        // Below the nav drawer (z-40) and dialogs (z-50).
        "transition duration-base ease-in-out will-change-transform",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      )}
      style={{
        // Sit one notch (0.75rem) above the tab bar, clearing both the
        // bar itself and the iOS home indicator (safe-area inset).
        bottom:
          "calc(var(--mobile-tab-bar-height) + env(safe-area-inset-bottom, 0px) + 0.75rem)",
      }}
    >
      {action}
    </div>
  );
}
