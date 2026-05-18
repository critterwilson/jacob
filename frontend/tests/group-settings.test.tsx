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

import { apiPatch as apiPatchExport, apiPost as apiPostExport } from "@/lib/api";
const apiPatchMock = apiPatchExport as unknown as ReturnType<typeof vi.fn>;
const apiPostMock = apiPostExport as unknown as ReturnType<typeof vi.fn>;

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
  memberCap: 20,
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

// ── GroupMemberCapForm ────────────────────────────────────────────────────────

import { GroupMemberCapForm } from "@/components/groups/GroupMemberCapForm";

describe("GroupMemberCapForm", () => {
  beforeEach(() => {
    apiPatchMock.mockReset();
    apiPatchMock.mockResolvedValue({ gid: "g1", memberCap: 30 });
  });

  it("renders the current cap as default value", () => {
    render(<GroupMemberCapForm gid="g1" currentCap={25} memberCount={10} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(25);
  });

  it("falls back to 20 when currentCap is null", () => {
    render(<GroupMemberCapForm gid="g1" currentCap={null} memberCount={5} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(20);
  });

  it("calls PATCH /api/groups/{gid}/cap on submit", async () => {
    const user = userEvent.setup();
    render(<GroupMemberCapForm gid="g1" currentCap={20} memberCount={5} />);

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "30");

    await user.click(screen.getByRole("button", { name: /save cap/i }));

    await waitFor(() => expect(apiPatchMock).toHaveBeenCalled());
    const [path, body] = apiPatchMock.mock.calls[0];
    expect(path).toBe("/api/groups/g1/cap");
    expect((body as Record<string, unknown>).memberCap).toBe(30);
  });

  it("shows success banner after save", async () => {
    const user = userEvent.setup();
    render(<GroupMemberCapForm gid="g1" currentCap={20} memberCount={5} />);

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "30");
    await user.click(screen.getByRole("button", { name: /save cap/i }));

    await waitFor(() => expect(screen.getByText(/member cap updated/i)).toBeInTheDocument());
  });

  it("shows server error when PATCH fails", async () => {
    const { ApiError: ApiErrorClass } = await import("@/lib/api");
    apiPatchMock.mockRejectedValue(
      new ApiErrorClass(422, "cap_below_count", "Member cap cannot be lower than the current member count (10)."),
    );

    const user = userEvent.setup();
    render(<GroupMemberCapForm gid="g1" currentCap={20} memberCount={10} />);

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "30");
    await user.click(screen.getByRole("button", { name: /save cap/i }));

    await waitFor(() =>
      expect(screen.getByText(/member cap cannot be lower/i)).toBeInTheDocument(),
    );
  });
});

// ── JoinRequestButton group_at_cap ────────────────────────────────────────────

import { JoinRequestButton } from "@/components/discover/JoinRequestButton";

describe("JoinRequestButton — group_at_cap", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { uid: "alice", getIdToken: vi.fn().mockResolvedValue("tok") },
      loading: false,
    });
    apiPostMock.mockReset();
  });

  it("shows at-cap message when API returns group_at_cap", async () => {
    const { ApiError: ApiErrorClass } = await import("@/lib/api");
    apiPostMock.mockRejectedValue(
      new ApiErrorClass(409, "group_at_cap", "This group is at its member limit."),
    );

    const user = userEvent.setup();
    render(<JoinRequestButton gid="g1" joinMode="open" />);

    await user.click(screen.getByRole("button", { name: /join/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/member limit/i),
    );
  });

  it("shows generic error for other API errors", async () => {
    const { ApiError: ApiErrorClass } = await import("@/lib/api");
    apiPostMock.mockRejectedValue(
      new ApiErrorClass(500, "internal_error", "Server error"),
    );

    const user = userEvent.setup();
    render(<JoinRequestButton gid="g1" joinMode="open" />);

    await user.click(screen.getByRole("button", { name: /join/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/server error/i),
    );
  });
});
