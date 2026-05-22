/**
 * @vitest-environment jsdom
 *
 * Covers the FloatingActionBar primitive: it renders the page's one
 * primary action (link or button), is mobile-only, is visible at rest,
 * and hides on scroll-down / shows on scroll-up.
 *
 * The scroll position it tracks is the window (document): AppShell's
 * `<main>` declares `overflow-y: auto` but grows with its content rather
 * than scrolling internally, so the document is the real scroll
 * container. The last test pins that down as a regression guard.
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

  it("is visible at rest", () => {
    render(<FloatingActionBar label="New post" href="/feed/new" />);
    expect(screen.getByTestId("floating-action-bar")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("hides when scrolling down and reappears when scrolling up", () => {
    render(<FloatingActionBar label="New post" href="/feed/new" />);
    const bar = screen.getByTestId("floating-action-bar");
    const link = screen.getByRole("link", { name: "New post" });

    scrollWindowTo(400);
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).toHaveClass("opacity-0");
    // Hidden bar is taken out of the tab order.
    expect(link).toHaveAttribute("tabindex", "-1");

    scrollWindowTo(250);
    expect(bar).toHaveAttribute("aria-hidden", "false");
    expect(bar).toHaveClass("opacity-100");
    expect(link).not.toHaveAttribute("tabindex");
  });

  it("is always visible at the top of the page", () => {
    render(<FloatingActionBar label="New post" href="/feed/new" />);
    const bar = screen.getByTestId("floating-action-bar");

    scrollWindowTo(600);
    expect(bar).toHaveAttribute("aria-hidden", "true");
    // Back at the top — visible even though the last move was downward
    // earlier in the gesture.
    scrollWindowTo(0);
    expect(bar).toHaveAttribute("aria-hidden", "false");
  });

  // Regression: the bar used to resolve its scroll container by walking
  // up to the nearest `overflow-y: auto` ancestor. AppShell's <main>
  // carries `overflow-y: auto` but grows with its content instead of
  // scrolling — the document scrolls. Binding the listener to that dead
  // <main> meant the bar never reacted to scroll. It must track the
  // window even when nested under such an ancestor.
  it("tracks window scroll even when nested inside an overflow-y:auto ancestor", () => {
    render(
      <div style={{ overflowY: "auto" }}>
        <div>
          <FloatingActionBar label="New post" href="/feed/new" />
        </div>
      </div>,
    );
    const bar = screen.getByTestId("floating-action-bar");
    expect(bar).toHaveAttribute("aria-hidden", "false");

    scrollWindowTo(400);
    expect(bar).toHaveAttribute("aria-hidden", "true");

    scrollWindowTo(0);
    expect(bar).toHaveAttribute("aria-hidden", "false");
  });
});
