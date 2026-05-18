/**
 * @vitest-environment jsdom
 *
 * Tests for /settings/profile — the dedicated profile editor page.
 * Covers: pre-fill, validation, PATCH /api/users/me call + refresh, success
 * and error states.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/profile",
}));

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
  app: { __mock: "app" },
}));

const mockUser = {
  uid: "alice",
  email: "alice@example.com",
  displayName: "Alice",
};

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, loading: false, signOut: vi.fn() }),
}));

const mockProfile = {
  uid: "alice",
  displayName: "Alice",
  email: "alice@example.com",
  photoURL: null,
  role: "member",
  schemaVersion: 1,
  isMinor: false,
  createdAt: null,
  phone: "+1-555-0100",
  location: "Brooklyn",
  faithBackground: "Methodist",
};

const mockRefresh = vi.fn();

vi.mock("@/lib/hooks/useUser", () => ({
  useUser: () => ({
    loading: false,
    profile: mockProfile,
    refresh: mockRefresh,
  }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  apiPatch: vi.fn(),
}));

import { apiPatch as apiPatchExport } from "@/lib/api";
const apiPatchMock = apiPatchExport as unknown as ReturnType<typeof vi.fn>;

import ProfilePage from "@/app/(authed)/settings/profile/page";

describe("ProfilePage — /settings/profile", () => {
  beforeEach(() => {
    apiPatchMock.mockReset();
    apiPatchMock.mockResolvedValue(mockProfile);
    mockRefresh.mockClear();
  });

  it("pre-fills form with current profile values", () => {
    render(<ProfilePage />);
    expect(
      (
        screen.getByRole("textbox", { name: /display name/i }) as HTMLInputElement
      ).value,
    ).toBe("Alice");
    expect(
      (screen.getByRole("textbox", { name: /city/i }) as HTMLInputElement).value,
    ).toBe("Brooklyn");
  });

  it("calls PATCH /api/users/me with edited displayName and calls refresh on success", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    const nameInput = screen.getByRole("textbox", { name: /display name/i });
    await user.clear(nameInput);
    await user.type(nameInput, "Alicia");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(apiPatchMock).toHaveBeenCalledWith(
        "/api/users/me",
        expect.objectContaining({ displayName: "Alicia" }),
      );
    });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.getByText(/profile updated/i)).toBeInTheDocument();
  });

  it("shows error banner when PATCH fails", async () => {
    const { ApiError } = await import("@/lib/api");
    apiPatchMock.mockRejectedValueOnce(
      new ApiError(500, "internal", "Server error"),
    );

    const user = userEvent.setup();
    render(<ProfilePage />);

    const nameInput = screen.getByRole("textbox", { name: /display name/i });
    await user.clear(nameInput);
    await user.type(nameInput, "Alicia");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getByText(/server error/i)).toBeInTheDocument(),
    );
  });

  it("shows validation error when display name is too short (< 2 chars)", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    const nameInput = screen.getByRole("textbox", { name: /display name/i });
    await user.clear(nameInput);
    await user.type(nameInput, "A");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/at least 2 characters/i),
      ).toBeInTheDocument(),
    );
    expect(apiPatchMock).not.toHaveBeenCalled();
  });

  it("shows validation error when display name exceeds max length", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    const nameInput = screen.getByRole("textbox", { name: /display name/i });
    await user.clear(nameInput);
    await user.type(nameInput, "A".repeat(51));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getByText(/max 50 characters/i)).toBeInTheDocument(),
    );
    expect(apiPatchMock).not.toHaveBeenCalled();
  });
});

describe("SettingsPage — /settings index", () => {
  it("renders links to all settings sub-pages", async () => {
    const { default: SettingsPage } = await import(
      "@/app/(authed)/settings/page"
    );
    render(<SettingsPage />);
    expect(screen.getByRole("link", { name: /edit profile/i })).toHaveAttribute(
      "href",
      "/settings/profile",
    );
    expect(
      screen.getByRole("link", { name: /notification settings/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /blocked users/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /export my data/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /delete account/i }),
    ).toBeInTheDocument();
  });
});
