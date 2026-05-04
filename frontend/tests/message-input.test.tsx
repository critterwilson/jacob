/**
 * @vitest-environment jsdom
 *
 * MessageInput tests, split out of chat.test.tsx — when MessageInput
 * (react-hook-form + zod + StickerPicker + apiPost) sat alongside
 * MessageList's `vi.resetModules()` + dynamic-import tests in the same
 * file, the worker reproducibly OOMed mid-suite. The split keeps the
 * MessageInput coverage and lets the file finish in <1s.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
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

vi.mock("@/lib/hooks/useStickers", () => ({
  useStickers: () => ({
    stickers: [
      { id: "check-in", slug: "check-in", name: "Check-In", audience: "christian", order: 1, color: "#2563EB" },
      { id: "prayer-request", slug: "prayer-request", name: "Prayer Request", audience: "christian", order: 2, color: "#7C3AED" },
    ],
    loading: false,
  }),
}));

vi.mock("@/lib/hooks/useMembers", () => ({
  useMembers: () => ({ members: [], loading: false, refresh: vi.fn() }),
}));

const { apiPostMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: apiPostMock,
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { MessageInput } from "@/components/chat/MessageInput";

describe("MessageInput", () => {
  beforeEach(() => {
    apiPostMock.mockReset();
    apiPostMock.mockImplementation(async () => ({ id: "new-msg" }));
  });

  it("shows validation error when body and attachments are both empty", async () => {
    render(<MessageInput gid="g1" />);
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(
      await screen.findByText(/add a message or a photo/i),
    ).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("shows validation error when body exceeds 4000 characters", async () => {
    render(<MessageInput gid="g1" />);
    fireEvent.change(screen.getByLabelText(/message body/i), {
      target: { value: "a".repeat(4001) },
    });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/4000 characters/i)).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it("defaults to check-in sticker when no sticker selected", async () => {
    render(<MessageInput gid="g1" />);
    await userEvent.type(screen.getByLabelText(/message body/i), "Hello!");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());
    const [path, data] = apiPostMock.mock.calls[0];
    expect(path).toBe("/api/groups/g1/messages");
    expect((data as Record<string, unknown>).stickerIds).toEqual(["check-in"]);
  });

  it("uses selected stickers when provided", async () => {
    render(<MessageInput gid="g1" />);
    await userEvent.click(screen.getByRole("button", { name: "Prayer Request" }));
    await userEvent.type(screen.getByLabelText(/message body/i), "Please pray");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());
    const [, data] = apiPostMock.mock.calls[0];
    expect((data as Record<string, unknown>).stickerIds).toContain("prayer-request");
  });

  it("shows error message when apiPost fails", async () => {
    apiPostMock.mockReset();
    apiPostMock.mockImplementation(async () => {
      throw new Error("network error");
    });

    render(<MessageInput gid="g1" />);
    await userEvent.type(screen.getByLabelText(/message body/i), "test");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/failed to send/i)).toBeInTheDocument();
  });
});
