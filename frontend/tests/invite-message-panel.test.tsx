/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InviteMessagePanel,
  buildInviteMessage,
} from "@/components/groups/InviteMessagePanel";

// URL that getInviteUrl() produces in jsdom — origin matches window.location.origin in the test env
const INVITE_URL = `${window.location.origin}/join?code=ABCD1234`;
const GROUP_NAME = "Sunday Crew";

function renderPanel(overrides?: Partial<Parameters<typeof InviteMessagePanel>[0]>) {
  return render(
    <InviteMessagePanel
      groupName={GROUP_NAME}
      inviteUrl={INVITE_URL}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

// ── buildInviteMessage (pure) ──────────────────────────────────────────────────

describe("buildInviteMessage", () => {
  it("includes group name and invite URL", () => {
    const msg = buildInviteMessage(GROUP_NAME, INVITE_URL, "", "");
    expect(msg).toContain(GROUP_NAME);
    expect(msg).toContain(INVITE_URL);
  });

  it("uses generic greeting when no recipient name provided", () => {
    const msg = buildInviteMessage(GROUP_NAME, INVITE_URL, "", "");
    expect(msg).toMatch(/hi there/i);
  });

  it("personalises greeting with recipient name", () => {
    const msg = buildInviteMessage(GROUP_NAME, INVITE_URL, "Sarah", "");
    expect(msg).toContain("Hi Sarah!");
    expect(msg).not.toMatch(/hi there/i);
  });

  it("includes personal note when provided", () => {
    const msg = buildInviteMessage(GROUP_NAME, INVITE_URL, "", "We meet on Thursdays.");
    expect(msg).toContain("We meet on Thursdays.");
  });

  it("omits personal note section when blank", () => {
    const msg = buildInviteMessage(GROUP_NAME, INVITE_URL, "", "   ");
    expect(msg).not.toContain("We meet");
  });
});

// ── InviteMessagePanel (component) ────────────────────────────────────────────

describe("InviteMessagePanel", () => {
  let clipboardSpy: MockInstance;

  beforeEach(() => {
    // jsdom 25 ships a real Clipboard object — spy on it rather than trying to
    // redefine the property, which is non-configurable on the prototype.
    if (!navigator.clipboard) {
      Object.defineProperty(global.navigator, "clipboard", {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
        writable: true,
      });
    }
    clipboardSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    Object.defineProperty(global.navigator, "share", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders preview containing group name and invite URL", () => {
    renderPanel();
    const preview = screen.getByTestId("message-preview");
    expect(preview).toHaveTextContent(GROUP_NAME);
    expect(preview).toHaveTextContent(INVITE_URL);
  });

  it("preview updates when recipient name is typed", async () => {
    const user = userEvent.setup();
    renderPanel();
    const nameInput = screen.getByLabelText(/recipient first name/i);
    await user.type(nameInput, "Sarah");
    const preview = screen.getByTestId("message-preview");
    expect(preview).toHaveTextContent("Hi Sarah!");
  });

  it("preview updates when personal note is typed", async () => {
    const user = userEvent.setup();
    renderPanel();
    const noteInput = screen.getByLabelText(/personal note/i);
    await user.type(noteInput, "We meet on Thursdays.");
    const preview = screen.getByTestId("message-preview");
    expect(preview).toHaveTextContent("We meet on Thursdays.");
  });

  it("copy button calls clipboard.writeText with the full message", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /copy message/i }));
    await waitFor(() => expect(clipboardSpy).toHaveBeenCalledOnce());
    const written = clipboardSpy.mock.calls[0][0] as string;
    expect(written).toContain(GROUP_NAME);
    expect(written).toContain(INVITE_URL);
  });

  it("shows Copied! feedback after copy", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /copy message/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument(),
    );
  });

  it("share button is absent when navigator.share is not available", () => {
    renderPanel();
    expect(screen.queryByTestId("share-button")).toBeNull();
  });

  it("share button is present when navigator.share is available", () => {
    Object.defineProperty(global.navigator, "share", {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });
    renderPanel();
    expect(screen.getByTestId("share-button")).toBeInTheDocument();
  });

  it("share button calls navigator.share with message text", async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "share", {
      value: mockShare,
      writable: true,
      configurable: true,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("share-button"));
    await waitFor(() => expect(mockShare).toHaveBeenCalledOnce());
    const shareArg = mockShare.mock.calls[0][0] as { text: string };
    expect(shareArg.text).toContain(INVITE_URL);
    expect(shareArg.text).toContain(GROUP_NAME);
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onClose });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onClose });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
