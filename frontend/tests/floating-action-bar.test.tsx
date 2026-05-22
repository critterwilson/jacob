/**
 * @vitest-environment jsdom
 *
 * Covers the FloatingActionBar primitive: it renders the page's one
 * primary action (link or button), is mobile-only, and hides on
 * scroll-down / shows on scroll-up.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FloatingActionBar } from "@/components/ui";

// Run the rAF coalescing synchronously so a scroll event settles inside
// fireEvent's act() wrapper.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Renders the bar inside a scrollable container the component will find. */
function renderInScroller(ui: React.ReactNode) {
  const result = render(
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <div style={{ height: "3000px" }}>{ui}</div>
    </div>,
  );
  return { ...result, scroller: screen.getByTestId("scroller") };
}

function scrollTo(el: HTMLElement, y: number) {
  el.scrollTop = y;
  fireEvent.scroll(el);
}

describe("FloatingActionBar", () => {
  it("renders a link to the given href", () => {
    renderInScroller(<FloatingActionBar label="New post" href="/feed/new" />);
    const link = screen.getByRole("link", { name: "New post" });
    expect(link).toHaveAttribute("href", "/feed/new");
    // Styled as the primary (gold) action per docs/design-system.md §9.
    expect(link).toHaveClass("bg-gold");
  });

  it("renders a button that fires onClick", () => {
    const onClick = vi.fn();
    renderInScroller(
      <FloatingActionBar label="New event" onClick={onClick} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New event" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is mobile-only — the bar carries md:hidden", () => {
    renderInScroller(<FloatingActionBar label="New post" href="/feed/new" />);
    expect(screen.getByTestId("floating-action-bar")).toHaveClass("md:hidden");
  });

  it("is visible at rest", () => {
    renderInScroller(<FloatingActionBar label="New post" href="/feed/new" />);
    expect(screen.getByTestId("floating-action-bar")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("hides when scrolling down and reappears when scrolling up", () => {
    const { scroller } = renderInScroller(
      <FloatingActionBar label="New post" href="/feed/new" />,
    );
    const bar = screen.getByTestId("floating-action-bar");
    const link = screen.getByRole("link", { name: "New post" });

    scrollTo(scroller, 400);
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).toHaveClass("opacity-0");
    // Hidden bar is taken out of the tab order.
    expect(link).toHaveAttribute("tabindex", "-1");

    scrollTo(scroller, 250);
    expect(bar).toHaveAttribute("aria-hidden", "false");
    expect(bar).toHaveClass("opacity-100");
    expect(link).not.toHaveAttribute("tabindex");
  });

  it("is always visible at the top of the page", () => {
    const { scroller } = renderInScroller(
      <FloatingActionBar label="New post" href="/feed/new" />,
    );
    const bar = screen.getByTestId("floating-action-bar");

    scrollTo(scroller, 600);
    expect(bar).toHaveAttribute("aria-hidden", "true");
    // Back at the top — visible even though the last move was downward
    // earlier in the gesture.
    scrollTo(scroller, 0);
    expect(bar).toHaveAttribute("aria-hidden", "false");
  });
});
