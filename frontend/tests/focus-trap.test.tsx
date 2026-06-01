/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for useFocusTrap + the dialog hardening across
 * ThreadPanel, PinnedSheet, GroupArchiveDialog, and ReportDialog.
 *
 * Asserts: Tab cycles within the dialog; Shift+Tab cycles backward;
 * ESC fires onClose; aria-modal="true" + role="dialog" present; backdrop is a
 * real button.
 *
 * NOTE: the AppShell mobile hamburger drawer (previously the canonical
 * focus-trapped nav surface) was removed in the v2 redesign (§7.1) — all
 * mobile nav now lives in the bottom tab bar + slim top bar. Its
 * focus-trap assertions were removed with it; the useFocusTrap unit tests
 * below still cover the hook itself.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { ReportDialog } from "@/components/moderation/ReportDialog";

// ── Mocks shared across dialog renders ─────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn().mockResolvedValue({}),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      uid: "alice",
      email: "alice@example.com",
      getIdToken: vi.fn().mockResolvedValue("fake-token"),
    },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useThreadMessages", () => ({
  useThreadMessages: vi.fn(() => ({
    messages: [],
    loading: false,
    loadingOlder: false,
    hasMore: false,
    loadOlder: vi.fn(),
  })),
}));

vi.mock("@/lib/hooks/useReactions", () => ({
  useReactions: () => ({
    isMyReaction: () => false,
    toggle: vi.fn(),
    mergeReactionCounts: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: [], loading: false }),
}));

vi.mock("@/lib/hooks/useReport", () => ({
  useReport: () => ({
    submit: vi.fn().mockResolvedValue({ dedup: false }),
    submitting: false,
    error: null,
  }),
}));

vi.mock("@/components/account/DeletionBanner", () => ({
  DeletionBanner: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = "";
});

// ── useFocusTrap unit tests ────────────────────────────────────────────────
function TrapHarness({
  onEscape,
  active = true,
}: {
  onEscape?: () => void;
  active?: boolean;
}) {
  const ref = useFocusTrap<HTMLDivElement>({ active, onEscape });
  return (
    <div ref={ref} data-testid="trap" role="dialog" aria-modal="true">
      <button>first</button>
      <button>middle</button>
      <button>last</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("focuses the first focusable element on activation", async () => {
    render(<TrapHarness />);
    await waitFor(() =>
      expect(screen.getByText("first")).toHaveFocus(),
    );
  });

  it("Tab cycles forward (last → first)", async () => {
    const user = userEvent.setup();
    render(<TrapHarness />);
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus());

    await user.tab();
    expect(screen.getByText("middle")).toHaveFocus();

    await user.tab();
    expect(screen.getByText("last")).toHaveFocus();

    // Wrap forward.
    await user.tab();
    expect(screen.getByText("first")).toHaveFocus();
  });

  it("Shift+Tab cycles backward (first → last)", async () => {
    const user = userEvent.setup();
    render(<TrapHarness />);
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus());

    await user.tab({ shift: true });
    expect(screen.getByText("last")).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByText("middle")).toHaveFocus();
  });

  it("Escape calls onEscape", async () => {
    const onEscape = vi.fn();
    const user = userEvent.setup();
    render(<TrapHarness onEscape={onEscape} />);
    await waitFor(() => expect(screen.getByText("first")).toHaveFocus());

    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

// ── ThreadPanel ────────────────────────────────────────────────────────────
describe("ThreadPanel (M-FRONT-2)", () => {
  it("renders as role=dialog with aria-modal=true", async () => {
    const { ThreadPanel } = await import("@/components/chat/ThreadPanel");
    render(
      <ThreadPanel
        gid="g1"
        parentMessage={{
          id: "m1",
          authorUid: "alice",
          body: "hello",
          stickerIds: [],
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
          parentMessageId: null,
          threadReplyCount: 0,
          mediaRefs: [],
        }}
        isLeader={false}
        currentUserUid="alice"
        archived={false}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /thread/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("Escape closes via onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { ThreadPanel } = await import("@/components/chat/ThreadPanel");
    render(
      <ThreadPanel
        gid="g1"
        parentMessage={{
          id: "m1",
          authorUid: "alice",
          body: "hello",
          stickerIds: [],
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
          parentMessageId: null,
          threadReplyCount: 0,
          mediaRefs: [],
        }}
        isLeader={false}
        currentUserUid="alice"
        archived={false}
        onClose={onClose}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

// ── PinnedSheet ────────────────────────────────────────────────────────────
describe("PinnedSheet (M-FRONT-2)", () => {
  it("renders as role=dialog with aria-modal=true and backdrop button", async () => {
    const { PinnedSheet } = await import("@/components/chat/PinnedSheet");
    render(
      <PinnedSheet
        gid="g1"
        pinned={[]}
        isLeader={false}
        onUnpin={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /pinned messages/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const backdrop = screen.getByRole("button", {
      name: /dismiss pinned messages/i,
    });
    expect(backdrop.tagName).toBe("BUTTON");
  });

  it("Escape closes via onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { PinnedSheet } = await import("@/components/chat/PinnedSheet");
    render(
      <PinnedSheet
        gid="g1"
        pinned={[]}
        isLeader={false}
        onUnpin={vi.fn()}
        onClose={onClose}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

// ── GroupArchiveDialog ─────────────────────────────────────────────────────
async function openArchiveDialog() {
  const { GroupArchiveDialog } = await import(
    "@/components/groups/GroupArchiveDialog"
  );
  render(<GroupArchiveDialog gid="g1" isArchived={false} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /archive group/i }));
  return { user };
}

describe("GroupArchiveDialog (M-FRONT-2)", () => {
  it("renders as role=dialog with aria-modal=true and a backdrop button", async () => {
    await openArchiveDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("button", { name: /dismiss dialog/i }).tagName,
    ).toBe("BUTTON");
  });

  it("Escape closes the dialog", async () => {
    const { user } = await openArchiveDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("Tab cycles between Cancel and Archive (and the textarea)", async () => {
    const { user } = await openArchiveDialog();
    const dialog = screen.getByRole("dialog");
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

// ── ReportDialog ───────────────────────────────────────────────────────────
function ReportDialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <ReportDialog
      open={open}
      onClose={() => setOpen(false)}
      resourceType="message"
      resourceId="m1"
    />
  );
}

describe("ReportDialog (M-FRONT-2)", () => {
  it("renders as role=dialog with aria-modal=true and backdrop button", async () => {
    render(<ReportDialogHarness />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("button", { name: /dismiss report dialog/i }).tagName,
    ).toBe("BUTTON");
  });

  it("Escape closes the dialog", async () => {
    const user = userEvent.setup();
    render(<ReportDialogHarness />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("Tab stays inside the dialog", async () => {
    const user = userEvent.setup();
    render(<ReportDialogHarness />);
    const dialog = screen.getByRole("dialog");
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
