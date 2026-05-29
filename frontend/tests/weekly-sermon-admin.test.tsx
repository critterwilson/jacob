/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { __mock: "auth" },
  firestore: { __mock: "firestore" },
  app: { __mock: "app" },
}));

let ownerMock: boolean | null = true;
vi.mock("@/lib/hooks/useMinistryOwner", () => ({
  useMinistryOwner: () => ownerMock,
}));

const mutateMock = vi.fn();
vi.mock("@/lib/hooks/useWeeklySermon", () => ({
  useWeeklySermon: () => ({
    sermon: null,
    loading: false,
    error: undefined,
    mutate: mutateMock,
  }),
}));

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn(async () => ({})),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import WeeklySermonAdminPage from "@/app/(authed)/feed/weekly-sermon/page";
import { apiPost } from "@/lib/api";

const mockApiPost = apiPost as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  ownerMock = true;
  mutateMock.mockReset();
  mockApiPost.mockReset();
  mockApiPost.mockResolvedValue({});
});

describe("WeeklySermonAdminPage", () => {
  it("blocks non-owners", () => {
    ownerMock = false;
    render(<WeeklySermonAdminPage />);
    expect(
      screen.getByText(/only organization owners can manage the weekly sermon/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
  });

  it("lets an owner publish and posts the trimmed payload", async () => {
    const user = userEvent.setup();
    render(<WeeklySermonAdminPage />);

    await user.type(
      screen.getByLabelText(/video url/i),
      "https://youtu.be/abc123",
    );
    await user.type(screen.getByLabelText(/^title/i), "Abiding in the Vine");
    await user.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/api/admin/weekly-sermon", {
        videoUrl: "https://youtu.be/abc123",
        title: "Abiding in the Vine",
        description: "",
      });
    });
    expect(await screen.findByText(/everyone sees it on home now/i)).toBeInTheDocument();
    expect(mutateMock).toHaveBeenCalled();
  });

  it("does not publish when required fields are empty", async () => {
    // The url + title inputs are `required`, so the browser (and jsdom)
    // block submit before the handler runs — nothing is posted.
    const user = userEvent.setup();
    render(<WeeklySermonAdminPage />);
    await user.click(screen.getByRole("button", { name: /publish/i }));
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});
