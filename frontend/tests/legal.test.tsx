/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import GuidelinesPage from "@/app/guidelines/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

// The three legal pages are server components that synchronously
// read their markdown source from disk and render it through the
// LegalDocument shell. Each test confirms the DRAFT banner is
// prominently mounted (no launch-blocker docs slip through without
// the marker) and that a section heading from the actual document
// content rendered correctly through the markdown pipeline.

describe("Privacy Policy page", () => {
  it("renders the DRAFT banner and a known section heading", () => {
    render(<PrivacyPage />);

    const banner = screen.getByTestId("legal-draft-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/DRAFT/);
    expect(banner.textContent).toMatch(/legal counsel/i);

    expect(
      screen.getByRole("heading", { level: 1, name: /privacy policy/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /what we collect/i }),
    ).toBeInTheDocument();
  });
});

describe("Terms of Service page", () => {
  it("renders the DRAFT banner and a known section heading", () => {
    render(<TermsPage />);

    const banner = screen.getByTestId("legal-draft-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/DRAFT/);

    expect(
      screen.getByRole("heading", { level: 1, name: /terms of service/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /your account/i }),
    ).toBeInTheDocument();
  });

  it("links to the Community Guidelines (body link + footer)", () => {
    render(<TermsPage />);
    const links = screen.getAllByRole("link", { name: /community guidelines/i });
    // One inline reference inside the body, one in the page footer.
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/guidelines");
    }
  });
});

describe("Community Guidelines page", () => {
  it("renders the DRAFT banner and a known section heading", () => {
    render(<GuidelinesPage />);

    const banner = screen.getByTestId("legal-draft-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/DRAFT/);

    expect(
      screen.getByRole("heading", { level: 1, name: /community guidelines/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /treat each other with respect/i }),
    ).toBeInTheDocument();
  });
});
