/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Sticker } from "@/lib/hooks/useStickers";
import { StickerBadge } from "@/components/stickers/StickerBadge";
import {
  DEFAULT_STICKER_SLUG,
  StickerPicker,
} from "@/components/stickers/StickerPicker";

// ---------------------------------------------------------------------------
// Shared mock sticker data (mirrors firestore/seed/stickers.ts)
// ---------------------------------------------------------------------------
const MOCK_STICKERS: Sticker[] = [
  { id: "check-in",            slug: "check-in",            name: "Check-In",            audience: "christian", order: 1,  color: "#2563EB" },
  { id: "prayer-request",      slug: "prayer-request",      name: "Prayer Request",       audience: "christian", order: 2,  color: "#7C3AED" },
  { id: "praise-report",       slug: "praise-report",       name: "Praise Report",        audience: "christian", order: 3,  color: "#D97706" },
  { id: "offering-help",       slug: "offering-help",       name: "Offering Help",        audience: "christian", order: 4,  color: "#059669" },
  { id: "need-help",           slug: "need-help",           name: "Need Help",            audience: "christian", order: 5,  color: "#DC2626" },
  { id: "event-meetup",        slug: "event-meetup",        name: "Event / Meetup",       audience: "christian", order: 6,  color: "#DB2777" },
  { id: "roll-partner-needed", slug: "roll-partner-needed", name: "Roll Partner Needed",  audience: "bjj",       order: 11, color: "#6E8AA9" },
  { id: "encouragement",       slug: "encouragement",       name: "Encouragement",        audience: "general",   order: 21, color: "#7FB39A" },
];

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: MOCK_STICKERS, loading: false }),
}));

// ---------------------------------------------------------------------------
// StickerBadge — one render test per sticker
// ---------------------------------------------------------------------------
describe("StickerBadge", () => {
  for (const sticker of MOCK_STICKERS) {
    it(`renders ${sticker.slug}`, () => {
      const { container } = render(<StickerBadge sticker={sticker} />);
      const el = container.querySelector(`[data-sticker="${sticker.slug}"]`);
      expect(el).not.toBeNull();
      expect(el?.textContent).toBe(sticker.name);
      // badge has an inline color style (jsdom normalizes hex → rgb, so just
      // verify the property is set rather than matching the exact hex string)
      expect((el as HTMLElement | null)?.style.color).toBeTruthy();
    });
  }

  it("applies sm classes when size=sm (text-xs, font-normal)", () => {
    const { container } = render(
      <StickerBadge sticker={MOCK_STICKERS[0]} size="sm" />,
    );
    expect(container.firstChild).toHaveClass("text-xs");
    expect(container.firstChild).toHaveClass("font-normal");
  });

  it("applies md classes by default (text-sm, font-medium)", () => {
    const { container } = render(<StickerBadge sticker={MOCK_STICKERS[0]} />);
    expect(container.firstChild).toHaveClass("text-sm");
    expect(container.firstChild).toHaveClass("font-medium");
  });
});

// ---------------------------------------------------------------------------
// StickerPicker — interaction tests
// ---------------------------------------------------------------------------
describe("StickerPicker", () => {
  it("renders all stickers", () => {
    render(<StickerPicker value={[]} onChange={() => {}} />);
    for (const s of MOCK_STICKERS) {
      expect(screen.getByRole("button", { name: s.name })).toBeInTheDocument();
    }
  });

  it("marks selected stickers as aria-pressed=true", () => {
    render(
      <StickerPicker value={["check-in"]} onChange={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: "Check-In" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Prayer Request" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when a sticker is toggled on", async () => {
    const onChange = vi.fn();
    render(<StickerPicker value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Check-In" }));
    expect(onChange).toHaveBeenCalledWith(["check-in"]);
  });

  it("calls onChange when a selected sticker is toggled off", async () => {
    const onChange = vi.fn();
    render(
      <StickerPicker value={["check-in"]} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Check-In" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("disables unselected stickers when 2 are already selected", () => {
    render(
      <StickerPicker
        value={["check-in", "prayer-request"]}
        onChange={() => {}}
      />,
    );
    // selected ones are NOT disabled
    expect(screen.getByRole("button", { name: "Check-In" })).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Prayer Request" }),
    ).not.toBeDisabled();
    // unselected ones are disabled
    expect(screen.getByRole("button", { name: "Need Help" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Event / Meetup" }),
    ).toBeDisabled();
  });

  it("does not add a third sticker when 2 are selected", async () => {
    const onChange = vi.fn();
    render(
      <StickerPicker
        value={["check-in", "prayer-request"]}
        onChange={onChange}
      />,
    );
    // Need Help is disabled at 2 selections, so click should not fire onChange
    await userEvent.click(screen.getByRole("button", { name: "Need Help" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exports DEFAULT_STICKER_SLUG as check-in", () => {
    expect(DEFAULT_STICKER_SLUG).toBe("check-in");
  });

  it("groupAudience=christian hides bjj stickers but shows general ones", () => {
    render(<StickerPicker value={[]} onChange={() => {}} groupAudience="christian" />);
    // christian sticker visible
    expect(screen.getByRole("button", { name: "Check-In" })).toBeInTheDocument();
    // general sticker visible
    expect(screen.getByRole("button", { name: "Encouragement" })).toBeInTheDocument();
    // bjj-only sticker hidden
    expect(screen.queryByRole("button", { name: "Roll Partner Needed" })).not.toBeInTheDocument();
  });

  it("groupAudience=bjj hides christian stickers but shows general ones", () => {
    render(<StickerPicker value={[]} onChange={() => {}} groupAudience="bjj" />);
    expect(screen.getByRole("button", { name: "Roll Partner Needed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Encouragement" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check-In" })).not.toBeInTheDocument();
  });

  it("no groupAudience shows all stickers", () => {
    render(<StickerPicker value={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Check-In" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll Partner Needed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Encouragement" })).toBeInTheDocument();
  });
});
