/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  firestore: { __mock: "firestore" },
}));

vi.mock("@/lib/hooks/useDailyVerse", () => ({
  useDailyVerse: vi.fn(),
}));

import { useDailyVerse } from "@/lib/hooks/useDailyVerse";
import { DailyVerse } from "@/components/home/DailyVerse";

const mockUse = useDailyVerse as ReturnType<typeof vi.fn>;

describe("DailyVerse", () => {
  it("renders reference and text when verse is present", () => {
    mockUse.mockReturnValue({
      verse: {
        reference: "John 3:16",
        translation: "WEB",
        text: "For God so loved the world, that he gave his one and only Son.",
        source: "bible-api.com",
      },
      loading: false,
    });
    render(<DailyVerse />);
    expect(screen.getByText(/For God so loved the world/)).toBeInTheDocument();
    expect(screen.getByText(/John 3:16/)).toBeInTheDocument();
  });

  it("shows placeholder when verse doc is missing", () => {
    mockUse.mockReturnValue({ verse: null, loading: false });
    render(<DailyVerse />);
    expect(screen.getByText(/A new verse will appear shortly/i)).toBeInTheDocument();
  });

  it("shows skeleton while loading", () => {
    mockUse.mockReturnValue({ verse: null, loading: true });
    const { container } = render(<DailyVerse />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("external link has rel=noopener noreferrer", () => {
    mockUse.mockReturnValue({
      verse: {
        reference: "Psalm 23:1",
        translation: "WEB",
        text: "The Lord is my shepherd.",
        source: "bible-api.com",
      },
      loading: false,
    });
    render(<DailyVerse />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
