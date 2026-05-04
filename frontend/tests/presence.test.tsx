/**
 * @vitest-environment jsdom
 *
 * T48 — component-level tests for the presence + typing surface.
 *
 * Mocking `firebase/database` from a Vitest worker proved to deadlock
 * the worker (the lib's lazy module init holds an open handle); we
 * test the components by mocking the hooks they consume instead. The
 * hooks themselves are small wrappers around `set` / `onValue` /
 * `onDisconnect` — the integration boundary is exercised end-to-end
 * by manual QA against the emulator (see runbook).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const _presence: Array<{ uid: string; lastSeenAt: number }> = [];
const _typing: Array<{ uid: string; startedAt: number }> = [];

vi.mock("@/lib/hooks/usePresence", () => ({
  usePresence: () => ({ online: _presence, loading: false }),
}));

vi.mock("@/lib/hooks/useTyping", () => ({
  useTyping: () => ({ others: _typing, setTyping: vi.fn() }),
}));

import { PresenceBar } from "@/components/chat/PresenceBar";
import { TypingIndicator } from "@/components/chat/TypingIndicator";

beforeEach(() => {
  _presence.length = 0;
  _typing.length = 0;
});

describe("<PresenceBar /> (T48)", () => {
  it("renders nothing when presenceEnabled is false", () => {
    _presence.push({ uid: "alice", lastSeenAt: Date.now() });
    const { container } = render(
      <PresenceBar gid="g1" presenceEnabled={false} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing when no one is online", () => {
    const { container } = render(
      <PresenceBar gid="g1" presenceEnabled={true} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders the count when members are online", () => {
    _presence.push(
      { uid: "alice", lastSeenAt: Date.now() },
      { uid: "bob", lastSeenAt: Date.now() },
    );
    render(<PresenceBar gid="g1" presenceEnabled={true} />);
    expect(screen.getByText(/2 online/)).toBeInTheDocument();
  });
});

describe("<TypingIndicator /> (T48)", () => {
  it("renders nothing when no one else is typing", () => {
    const { container } = render(
      <TypingIndicator gid="g1" presenceEnabled={true} />,
    );
    expect(container.textContent).toBe("");
  });

  it("uses the resolveName callback when supplied", () => {
    _typing.push({ uid: "u-alice", startedAt: Date.now() });
    render(
      <TypingIndicator
        gid="g1"
        presenceEnabled={true}
        resolveName={(uid) => (uid === "u-alice" ? "Alice" : uid)}
      />,
    );
    expect(screen.getByText(/Alice is typing/)).toBeInTheDocument();
  });

  it("collapses 3+ typers into 'and N others'", () => {
    _typing.push(
      { uid: "u-alice", startedAt: Date.now() },
      { uid: "u-bob", startedAt: Date.now() },
      { uid: "u-carol", startedAt: Date.now() },
      { uid: "u-dave", startedAt: Date.now() },
    );
    render(
      <TypingIndicator
        gid="g1"
        presenceEnabled={true}
        resolveName={(uid) => uid.replace("u-", "")}
      />,
    );
    expect(screen.getByText(/2 others are typing/)).toBeInTheDocument();
  });

  it("renders nothing when presenceEnabled is false", () => {
    _typing.push({ uid: "u-alice", startedAt: Date.now() });
    const { container } = render(
      <TypingIndicator gid="g1" presenceEnabled={false} />,
    );
    expect(container.textContent).toBe("");
  });
});
