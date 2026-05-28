/**
 * @vitest-environment jsdom
 *
 * Covers the FloatingActionBar primitive: it renders the page's one
 * primary action (link or button), is mobile-only, is fixed above the
 * bottom tab bar, and stays visible at all times (no hide-on-scroll).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FloatingActionBar } from "@/components/ui";

afterEach(() => {
  setWindowScrollY(0);
});

/** jsdom has no layout — drive the window scroll position directly. */
function setWindowScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

function scrollWindowTo(y: number) {
  setWindowScrollY(y);
  fireEvent.scroll(window);
}

describe("FloatingActionBar", () => {
  it("renders a link to the given href", () => {
    render(<FloatingActionBar label="New post" href="/feed/new" />);
    const link = screen.getByRole("link", { name: "New post" });
    expect(link).toHaveAttribute("href", "/feed/new");
    // Styled as the primary (gold) action per docs/design-system.md §9.
    expect(link).toHaveClass("bg-gold");
  });

  it("renders a button that fires onClick", () => {
    const onClick = vi.fn();
    render(<FloatingActionBar label="New event" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "New event" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is mobile-only — the bar carries md:hidden", () => {
    render(<FloatingActionBar label="New post" href="/feed/new" />);
    expect(screen.getByTestId("floating-action-bar")).toHaveClass("md:hidden");
  });

  it("is fixed-positioned above the tab bar", () => {
    render(<FloatingActionBar label="New post" href="/feed/new" />);
    const bar = screen.getByTestId("floating-action-bar");
    expect(bar).toHaveClass("fixed");
    // Anchored above the bottom tab bar via the shared height token.
    expect(bar.style.bottom).toContain("--mobile-tab-bar-height");
  });

  it("stays visible regardless of scroll — no hide-on-scroll", () => {
    render(<FloatingActionBar label="New post" href="/feed/new" />);
    const bar = screen.getByTestId("floating-action-bar");
    const link = screen.getByRole("link", { name: "New post" });

    // Scrolling down used to hide it; now it stays put and interactive.
    scrollWindowTo(400);
    expect(bar).not.toHaveClass("opacity-0");
    expect(bar).not.toHaveClass("pointer-events-none");
    expect(link).not.toHaveAttribute("tabindex");
    expect(bar).not.toHaveAttribute("aria-hidden");

    // Scrolling back up changes nothing — it was never hidden.
    scrollWindowTo(0);
    expect(link).not.toHaveAttribute("tabindex");
  });
});
