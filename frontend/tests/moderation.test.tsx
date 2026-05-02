/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { buildReportUrl, ENTRY, isReportFormConfigured } from "@/lib/report-url";
import { ReportLink } from "@/components/moderation/ReportLink";

// ── Auth context ─────────────────────────────────────────────────────────────
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "user-123", email: "test@example.com" },
    loading: false,
    signOut: vi.fn(),
  }),
}));

// Set the form ID env var so the module behaves as configured.
const FAKE_FORM_ID = "1FAIpQLSfABCD1234";

beforeEach(() => {
  process.env.NEXT_PUBLIC_REPORT_FORM_ID = FAKE_FORM_ID;
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_REPORT_FORM_ID;
  vi.clearAllMocks();
});

// ── buildReportUrl ────────────────────────────────────────────────────────────
describe("buildReportUrl", () => {
  it("returns null when NEXT_PUBLIC_REPORT_FORM_ID is unset", () => {
    delete process.env.NEXT_PUBLIC_REPORT_FORM_ID;
    expect(buildReportUrl({ contentType: "message" })).toBeNull();
  });

  it("includes content_id, group_id, and reporter_uid for a message report", () => {
    const url = buildReportUrl({
      contentType: "message",
      contentId: "msg-abc",
      groupId: "grp-xyz",
      reporterUid: "user-123",
    });
    const parsed = new URL(url!);
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
    const parsed = new URL(url!);
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
    const parsed = new URL(url!);
    expect(parsed.searchParams.has(ENTRY.reporterUid)).toBe(false);
  });

  it("uses the configured FORM_ID in the URL", () => {
    const url = buildReportUrl({ contentType: "message" });
    expect(url).toContain(FAKE_FORM_ID);
  });
});

// ── isReportFormConfigured ────────────────────────────────────────────────────
describe("isReportFormConfigured", () => {
  it("returns true when NEXT_PUBLIC_REPORT_FORM_ID is set", () => {
    expect(isReportFormConfigured()).toBe(true);
  });

  it("returns false when NEXT_PUBLIC_REPORT_FORM_ID is unset", () => {
    delete process.env.NEXT_PUBLIC_REPORT_FORM_ID;
    expect(isReportFormConfigured()).toBe(false);
  });
});

// ── ReportLink (form configured) ─────────────────────────────────────────────
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

  it("opens in a new tab (target=_blank)", () => {
    render(
      <ReportLink contentType="message" contentId="msg-abc" groupId="grp-xyz" />,
    );
    const link = screen.getByRole("link", { name: /report/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when NEXT_PUBLIC_REPORT_FORM_ID is unset", () => {
    delete process.env.NEXT_PUBLIC_REPORT_FORM_ID;
    const { container } = render(
      <ReportLink contentType="message" contentId="msg-1" groupId="grp-1" />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── ReportLink (anonymous) ────────────────────────────────────────────────────
describe("ReportLink (anonymous)", () => {
  it("leaves reporter_uid blank when user is not signed in", async () => {
    vi.resetModules();
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
