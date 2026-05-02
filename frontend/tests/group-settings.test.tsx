/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub Next.js navigation
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
}));

// Stub Firebase singletons
vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
}));

// Stub Firestore operations — vi.fn() defined inside factory to avoid hoisting issues.
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    doc: vi.fn((...args: unknown[]) => ({ path: args.join("/") })),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
      cb({ exists: () => true, data: () => ({ role: "leader" }) });
      return vi.fn();
    }),
  };
});

// Stub auth
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { uid: "alice", email: "alice@example.com", getIdToken: vi.fn().mockResolvedValue("tok") },
    loading: false,
  }),
}));

// Stub useGroup
vi.mock("@/lib/hooks/useGroup", () => ({
  useGroup: () => ({
    group: {
      id: "g1",
      name: "My Group",
      description: "A group",
      isPrivate: false,
      memberCount: 2,
      stickerSet: "christian",
      createdBy: "alice",
      inviteCode: "ABCD1234",
      schemaVersion: 1,
      createdAt: null,
      avatarUrl: null,
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
    },
    loading: false,
  }),
}));

// Stub upload hook used by GroupAvatarUpload
vi.mock("@/lib/hooks/useUploadPhoto", () => ({
  useUploadPhoto: () => ({ upload: vi.fn(), uploading: false, progress: "idle" }),
  ALLOWED_PHOTO_MIME_TYPES: ["image/jpeg"],
  UploadError: class extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockReplace.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

// ── GroupSettingsForm ─────────────────────────────────────────────────────────

import { GroupSettingsForm } from "@/components/groups/GroupSettingsForm";
import { updateDoc } from "firebase/firestore";

describe("GroupSettingsForm", () => {
  it("calls updateDoc with allowed fields on submit", async () => {
    render(
      <GroupSettingsForm
        gid="g1"
        initialValues={{ name: "My Group", description: "A group", isPrivate: false }}
      />,
    );

    await userEvent.clear(screen.getByLabelText(/group name/i));
    await userEvent.type(screen.getByLabelText(/group name/i), "New Name");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateDoc).toHaveBeenCalledOnce());
    const [, payload] = (updateDoc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({ name: "New Name" });
    expect(Object.keys(payload as object)).not.toContain("archivedAt");
    expect(Object.keys(payload as object)).not.toContain("memberCount");
  });

  it("shows validation error for empty name", async () => {
    render(
      <GroupSettingsForm
        gid="g1"
        initialValues={{ name: "My Group", description: "", isPrivate: false }}
      />,
    );

    await userEvent.clear(screen.getByLabelText(/group name/i));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

// ── ArchivedBanner ────────────────────────────────────────────────────────────

import { ArchivedBanner } from "@/components/groups/ArchivedBanner";

describe("ArchivedBanner", () => {
  it("renders the archived message", () => {
    render(<ArchivedBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/archived/i);
  });

  it("shows unarchive button for leaders", () => {
    const onUnarchive = vi.fn();
    render(<ArchivedBanner isLeader onUnarchive={onUnarchive} />);
    expect(screen.getByRole("button", { name: /unarchive/i })).toBeInTheDocument();
  });

  it("hides unarchive button for non-leaders", () => {
    render(<ArchivedBanner isLeader={false} />);
    expect(screen.queryByRole("button", { name: /unarchive/i })).toBeNull();
  });
});

// ── MessageInput archived prop ────────────────────────────────────────────────

import { MessageInput } from "@/components/chat/MessageInput";

vi.mock("@/lib/hooks/useStickers", () => ({ useStickers: () => ({ stickers: [] }) }));

describe("MessageInput", () => {
  it("renders disabled archived notice when archived=true", () => {
    render(<MessageInput gid="g1" archived />);
    const el = screen.getByLabelText(/message input disabled/i);
    expect(el).toHaveTextContent(/archived/i);
    expect(screen.queryByLabelText(/send a message/i)).toBeNull();
  });

  it("renders the form when archived=false", () => {
    render(<MessageInput gid="g1" archived={false} />);
    expect(screen.getByLabelText(/send a message/i)).toBeInTheDocument();
  });
});
