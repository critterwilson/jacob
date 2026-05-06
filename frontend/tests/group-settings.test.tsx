/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: {},
  firestore: {},
}));

const mockUnsubscribe = vi.fn();

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ _type: "serverTimestamp" })),
  Timestamp: { now: vi.fn() },
}));

import * as fbFirestore from "firebase/firestore";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { apiPatch as apiPatchExport } from "@/lib/api";
const apiPatchMock = apiPatchExport as unknown as ReturnType<typeof vi.fn>;

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseGroup = vi.fn();
vi.mock("@/lib/hooks/useGroup", () => ({
  useGroup: () => mockUseGroup(),
}));

import { ArchivedBanner } from "@/components/groups/ArchivedBanner";
import { GroupSettingsForm } from "@/components/groups/GroupSettingsForm";
import { MessageInput } from "@/components/chat/MessageInput";
import type { Group } from "@/lib/hooks/useGroup";

const fakeGroup: Group = {
  id: "g1",
  gid: "g1",
  name: "Test Group",
  description: "A great group",
  isPrivate: false,
  joinMode: null,
  audience: null,
  stickerSet: "christian",
  avatarUrl: null,
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  pinnedMessageIds: [],
  memberCount: 3,
  leaderCount: 1,
  founderUid: "alice",
  createdBy: "alice",
  createdAt: null,
  inviteCode: "TESTCODE",
  moderationPolicy: null,
  presenceEnabled: null,
};

// ── ArchivedBanner ─────────────────────────────────────────────────────────────

describe("ArchivedBanner", () => {
  it("renders archived message", () => {
    render(<ArchivedBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/archived/i);
  });
});

// ── MessageInput archived prop ────────────────────────────────────────────────

vi.mock("@/lib/hooks/useUploadPhoto", () => ({
  useUploadPhoto: () => ({ upload: vi.fn(), uploading: false, progress: "idle" }),
  ALLOWED_PHOTO_MIME_TYPES: ["image/jpeg", "image/png", "image/webp"],
  MAX_PHOTO_BYTES: 8 * 1024 * 1024,
  UploadError: class UploadError extends Error {},
}));

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({ stickers: [], loading: false }),
}));

vi.mock("@/components/stickers/StickerPicker", () => ({
  StickerPicker: () => null,
  DEFAULT_STICKER_SLUG: "pray",
}));

vi.mock("@/components/chat/PhotoAttachButton", () => ({
  PhotoAttachButton: () => null,
}));

describe("MessageInput", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("tok") },
      loading: false,
    });
  });

  it("shows disabled message when archived prop is true", () => {
    render(<MessageInput gid="g1" archived={true} />);
    expect(screen.getByText(/archived/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders the textarea when not archived", () => {
    render(<MessageInput gid="g1" archived={false} />);
    expect(screen.getByRole("textbox", { name: /message body/i })).toBeInTheDocument();
  });
});

// ── GroupSettingsForm ─────────────────────────────────────────────────────────

describe("GroupSettingsForm", () => {
  beforeEach(() => {
    apiPatchMock.mockReset();
    apiPatchMock.mockResolvedValue({});
  });

  it("calls apiPatch with only allowed fields on submit", async () => {
    const user = userEvent.setup();
    render(<GroupSettingsForm gid="g1" group={fakeGroup} />);

    const nameInput = screen.getByLabelText(/group name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(apiPatchMock).toHaveBeenCalled());
    const [path, data] = apiPatchMock.mock.calls[0];
    expect(path).toBe("/api/groups/g1");
    const body = data as Record<string, unknown>;
    expect(body).toMatchObject({ name: "Updated Name" });
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["name", "description", "isPrivate"]),
    );
  });
});
