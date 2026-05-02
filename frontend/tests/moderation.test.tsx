/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildReportUrl, ENTRY } from "@/lib/report-url";
import { ReportLink } from "@/components/moderation/ReportLink";

// ── Auth context ─────────────────────────────────────────────────────────────
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "user-123", email: "test@example.com" },
    loading: false,
    signOut: vi.fn(),
  }),
}));

// ── buildReportUrl ────────────────────────────────────────────────────────────
describe("buildReportUrl", () => {
  it("includes content_id, group_id, and reporter_uid for a message report", () => {
    const url = buildReportUrl({
      contentType: "message",
      contentId: "msg-abc",
      groupId: "grp-xyz",
      reporterUid: "user-123",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get(ENTRY.contentType)).toBe("message");
    expect(parsed.searchParams.get(ENTRY.contentId)).toBe("msg-abc");
    expect(parsed.searchParams.get(ENTRY.groupId)).toBe("grp-xyz");
    expect(parsed.searchParams.get(ENTRY.reporterUid)).toBe("user-123");
    expect(parsed.searchParams.get(ENTRY.timestamp)).toBeTruthy();
  });

  it("includes group_id and reporter_uid for a group report", () => {
    const url = buildReportUrl({
      contentType: "group",
      groupId: "grp-xyz",
      reporterUid: "user-123",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get(ENTRY.contentType)).toBe("group");
    expect(parsed.searchParams.has(ENTRY.contentId)).toBe(false);
    expect(parsed.searchParams.get(ENTRY.groupId)).toBe("grp-xyz");
    expect(parsed.searchParams.get(ENTRY.reporterUid)).toBe("user-123");
  });

  it("omits reporter_uid when undefined (anonymous report)", () => {
    const url = buildReportUrl({
      contentType: "message",
      contentId: "msg-abc",
      groupId: "grp-xyz",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has(ENTRY.reporterUid)).toBe(false);
  });

  it("opens in a new tab (target=_blank)", () => {
    render(
      <ReportLink contentType="message" contentId="msg-abc" groupId="grp-xyz" />,
    );
    const link = screen.getByRole("link", { name: /report/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

// ── ReportLink ────────────────────────────────────────────────────────────────
describe("ReportLink", () => {
  it("renders an accessible Report link", () => {
    render(
      <ReportLink contentType="message" contentId="msg-1" groupId="grp-1" />,
    );
    expect(screen.getByRole("link", { name: /report/i })).toBeInTheDocument();
  });

  it("prefills reporter_uid from auth context", () => {
    render(
      <ReportLink contentType="message" contentId="msg-1" groupId="grp-1" />,
    );
    const href = screen.getByRole("link", { name: /report/i }).getAttribute("href")!;
    const parsed = new URL(href);
    expect(parsed.searchParams.get(ENTRY.reporterUid)).toBe("user-123");
  });
});

// ── anonymous (no user) ───────────────────────────────────────────────────────
describe("ReportLink (anonymous)", () => {
  it("leaves reporter_uid blank when user is not signed in", async () => {
    vi.doMock("@/lib/auth-context", () => ({
      useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
    }));
    const { ReportLink: AnonReportLink } = await import(
      "@/components/moderation/ReportLink"
    );
    render(
      <AnonReportLink contentType="group" groupId="grp-1" />,
    );
    const href = screen.getByRole("link", { name: /report/i }).getAttribute("href")!;
    const parsed = new URL(href);
    expect(parsed.searchParams.has(ENTRY.reporterUid)).toBe(false);
  });
});
