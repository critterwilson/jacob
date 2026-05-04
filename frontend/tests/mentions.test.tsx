/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: {},
  firestore: {},
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  collection: vi.fn(),
  serverTimestamp: vi.fn(() => ({ _type: "serverTimestamp" })),
  addDoc: vi.fn().mockResolvedValue({ id: "new-mid" }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  Timestamp: { now: vi.fn() },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
  }),
}));

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: [], loading: false }),
}));

vi.mock("@/lib/hooks/useMembers", () => ({
  useMembers: () => ({
    members: [
      { uid: "bob", displayName: "Bob Smith" },
      { uid: "carol", displayName: "Carol Jones" },
    ],
    loading: false,
  }),
}));

import { useState } from "react";
import { extractMentionedUids, renderBodyWithMentions } from "@/lib/mentions";
import { MentionInput } from "@/components/chat/MentionInput";

// MentionInput accepts a narrower projection (just `uid`+`displayName`).
type MentionMember = { uid: string; displayName: string };

// Stateful wrapper so MentionInput re-renders with each onChange call.
function ControlledMention({
  members,
  onChangeSpy,
}: {
  members: MentionMember[];
  onChangeSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <MentionInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
      members={members}
      aria-label="msg"
    />
  );
}

const fakeMembers = [
  { uid: "bob", displayName: "Bob Smith" },
  { uid: "carol", displayName: "Carol Jones" },
];

// ── extractMentionedUids (pure) ───────────────────────────────────────────────

describe("extractMentionedUids", () => {
  it("extracts a single mention", () => {
    const uids = extractMentionedUids("Hey @Bob Smith how are you?", fakeMembers);
    expect(uids).toEqual(["bob"]);
  });

  it("extracts multiple mentions", () => {
    const uids = extractMentionedUids("@Bob Smith and @Carol Jones", fakeMembers);
    expect(uids).toContain("bob");
    expect(uids).toContain("carol");
    expect(uids).toHaveLength(2);
  });

  it("deduplicates repeated mentions", () => {
    const uids = extractMentionedUids("@Bob Smith @Bob Smith again", fakeMembers);
    expect(uids).toEqual(["bob"]);
  });

  it("returns empty array when no @-tokens", () => {
    const uids = extractMentionedUids("plain text no mentions", fakeMembers);
    expect(uids).toEqual([]);
  });

  it("is case-insensitive", () => {
    const uids = extractMentionedUids("@bob smith said hi", fakeMembers);
    expect(uids).toEqual(["bob"]);
  });
});

// ── renderBodyWithMentions (pure) ─────────────────────────────────────────────

describe("renderBodyWithMentions", () => {
  it("returns plain string when no mentions", () => {
    const parts = renderBodyWithMentions("hello world", [], fakeMembers);
    expect(parts).toEqual(["hello world"]);
  });

  it("returns chip tokens for mentioned uids", () => {
    const parts = renderBodyWithMentions(
      "Hey @Bob Smith!",
      ["bob"],
      fakeMembers,
      "alice",
    );
    expect(parts.some((p) => typeof p === "object" && p.displayName === "Bob Smith")).toBe(true);
  });

  it("marks isSelf when current user is mentioned", () => {
    const parts = renderBodyWithMentions(
      "@Bob Smith check this",
      ["bob"],
      fakeMembers,
      "bob",
    );
    const chip = parts.find((p) => typeof p === "object") as { isSelf: boolean } | undefined;
    expect(chip?.isSelf).toBe(true);
  });

  it("marks isSelf=false for another user's mention", () => {
    const parts = renderBodyWithMentions(
      "@Bob Smith check this",
      ["bob"],
      fakeMembers,
      "alice",
    );
    const chip = parts.find((p) => typeof p === "object") as { isSelf: boolean } | undefined;
    expect(chip?.isSelf).toBe(false);
  });
});

// ── MentionInput component ────────────────────────────────────────────────────

describe("MentionInput", () => {
  it("renders a textarea with the given aria-label", () => {
    render(
      <MentionInput
        value=""
        onChange={vi.fn()}
        members={fakeMembers}
        aria-label="Message body"
      />,
    );
    expect(screen.getByRole("textbox", { name: /message body/i })).toBeInTheDocument();
  });

  it("dropdown is closed when no @ typed", () => {
    render(
      <MentionInput value="hello" onChange={vi.fn()} members={fakeMembers} />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("typing @ followed by a prefix shows matching members in dropdown", async () => {
    const user = userEvent.setup();
    render(<ControlledMention members={fakeMembers} />);
    const ta = screen.getByRole("textbox", { name: "msg" });
    await user.click(ta);
    await user.type(ta, "@Bo");
    // Dropdown should appear with Bob Smith matching "@Bo"
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(within(listbox).getByText("Bob Smith")).toBeInTheDocument();
  });

  it("selecting a suggestion inserts @displayName into the textarea", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledMention members={fakeMembers} onChangeSpy={onChange} />);

    const ta = screen.getByRole("textbox", { name: "msg" });
    await user.click(ta);
    await user.type(ta, "@");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    // The handler is on the <button>, not the <li role=option>
    const bobBtn = within(listbox).getByRole("button", { name: /Bob Smith/i });
    // fireEvent.mouseDown avoids blur-before-click ordering in jsdom
    fireEvent.mouseDown(bobBtn);

    const allValues = onChange.mock.calls.map((args) => args[0] as string);
    expect(allValues.some((v) => v.startsWith("@Bob Smith"))).toBe(true);
  });

  it("ArrowDown / ArrowUp navigate the dropdown without errors", async () => {
    const user = userEvent.setup();
    render(<ControlledMention members={fakeMembers} />);
    const ta = screen.getByRole("textbox", { name: "msg" });
    await user.click(ta);
    await user.type(ta, "@");
    // Dropdown should now be open
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowUp}");
    // Dropdown still open after navigation
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("Escape closes the dropdown", async () => {
    const user = userEvent.setup();
    render(<ControlledMention members={fakeMembers} />);
    const ta = screen.getByRole("textbox", { name: "msg" });
    await user.click(ta);
    await user.type(ta, "@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
