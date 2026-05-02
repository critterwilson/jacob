/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ReportButton } from "@/components/moderation/ReportButton";
import { ReportDialog } from "@/components/moderation/ReportDialog";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      uid: "user-123",
      email: "test@example.com",
      getIdToken: vi.fn().mockResolvedValue("fake-token"),
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── ReportButton ─────────────────────────────────────────────────────────────

describe("ReportButton", () => {
  it("renders an accessible Report button", () => {
    render(
      <ReportButton resourceType="message" resourceId="msg-1" groupId="grp-1" />,
    );
    expect(
      screen.getByRole("button", { name: /report this message/i }),
    ).toBeInTheDocument();
  });

  it("opens the dialog when clicked", async () => {
    const user = userEvent.setup();
    render(
      <ReportButton resourceType="message" resourceId="msg-1" groupId="grp-1" />,
    );
    await user.click(screen.getByRole("button", { name: /report this message/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ── ReportDialog: submit flow ────────────────────────────────────────────────

describe("ReportDialog", () => {
  it("posts to /api/reports with the structured shape", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ reportId: "rid-1", dedup: false, severity: 2 }),
    });
    render(
      <ReportDialog
        open
        onClose={() => {}}
        resourceType="message"
        resourceId="msg-1"
        groupId="grp-1"
      />,
    );

    await user.selectOptions(
      screen.getByLabelText(/reason/i),
      "harassment",
    );
    await user.type(
      screen.getByLabelText(/add context/i),
      "they keep insulting people",
    );
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/reports");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      resourceType: "message",
      resourceId: "msg-1",
      groupId: "grp-1",
      reason: "harassment",
    });
    expect(body.context).toContain("insulting");

    expect(
      await screen.findByText(/your report has been sent/i),
    ).toBeInTheDocument();
  });

  it("surfaces a dedup acknowledgement when the API returns dedup=true", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ reportId: "rid-1", dedup: true, severity: 1 }),
    });
    render(
      <ReportDialog
        open
        onClose={() => {}}
        resourceType="message"
        resourceId="msg-1"
        groupId="grp-1"
      />,
    );
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    expect(
      await screen.findByText(/we already have this report/i),
    ).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: "banned", message: "Banned users cannot report" },
      }),
    });
    render(
      <ReportDialog
        open
        onClose={() => {}}
        resourceType="group"
        resourceId="grp-1"
      />,
    );
    await user.click(screen.getByRole("button", { name: /submit report/i }));
    expect(
      await screen.findByText(/banned users cannot report/i),
    ).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    const { container } = render(
      <ReportDialog
        open={false}
        onClose={() => {}}
        resourceType="message"
        resourceId="msg-1"
        groupId="grp-1"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
