"use client";

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

/**
 * A mobile-only, near-full-width primary action anchored just above the
 * bottom tab bar. It is a page's one `primary` CTA (docs/design-system.md
 * §9), simply relocated — so a page that renders this should not also show
 * an inline primary button for the same action on mobile. Desktop has no
 * tab bar: the component is `md:hidden` and pages keep their inline button.
 *
 * The bar is always visible — it stays fixed in place regardless of scroll
 * direction, so the primary action is never something you have to scroll
 * to reach. (It used to hide on scroll-down; Christopher's preference is
 * permanent visibility.)
 */
export function FloatingActionBar({
  label,
  href,
  onClick,
}: FloatingActionBarProps) {
  const action = href ? (
    <ButtonLink
      href={href}
      variant="primary"
      size="md"
      fullWidth
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
      className="shadow-raise"
    >
      {label}
    </Button>
  );

  return (
    <div
      data-testid="floating-action-bar"
      className={cn(
        // Mobile-only; desktop keeps the page's inline CTA.
        // z-30 sits above page content but below the nav drawer (z-40)
        // and dialogs (z-50).
        "fixed inset-x-4 z-30 md:hidden",
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
