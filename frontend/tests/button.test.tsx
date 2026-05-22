/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, ButtonLink } from "@/components/ui";

describe("Button", () => {
  it("defaults to a md primary, type=button", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn.className).toContain("bg-gold");
    expect(btn.className).toContain("h-11");
  });

  it("renders each variant with its own treatment", () => {
    const { rerender } = render(<Button variant="secondary">x</Button>);
    expect(screen.getByRole("button").className).toContain("border-line");
    rerender(<Button variant="ghost">x</Button>);
    expect(screen.getByRole("button").className).toContain("bg-transparent");
    rerender(<Button variant="destructive">x</Button>);
    expect(screen.getByRole("button").className).toContain("bg-terracotta");
  });

  it("maps fullWidth to width classes", () => {
    const { rerender } = render(<Button fullWidth>x</Button>);
    expect(screen.getByRole("button").className).toContain("w-full");
    // "mobile" is full-width below sm, auto-width above — the action-row rule.
    rerender(<Button fullWidth="mobile">x</Button>);
    expect(screen.getByRole("button").className).toContain("w-full");
    expect(screen.getByRole("button").className).toContain("sm:w-auto");
    rerender(<Button>x</Button>);
    expect(screen.getByRole("button").className).not.toContain("w-full");
  });

  it("is disabled and aria-busy while loading", () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});

describe("ButtonLink", () => {
  it("renders an anchor styled identically to a Button", () => {
    render(
      <ButtonLink href="/reading-plans" variant="primary">
        Browse plans
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Browse plans" });
    expect(link).toHaveAttribute("href", "/reading-plans");
    // Same gold/size treatment as Button primary md.
    expect(link.className).toContain("bg-gold");
    expect(link.className).toContain("h-11");
  });
});
