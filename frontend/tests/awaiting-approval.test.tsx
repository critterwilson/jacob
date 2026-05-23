/**
 * @vitest-environment jsdom
 *
 * `/awaiting-approval` is a legacy ADR 0012 route. Under ADR 0014 it
 * redirects to `?next=` (or `/home`) — no polling, no application UI.
 * This test pins that contract so old bookmarks don't 404 and a
 * future regression doesn't reintroduce a queue gate.
 */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const awaitingSearchParamsGet = vi.fn<(key: string) => string | null>(
  () => null,
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => ({ get: awaitingSearchParamsGet }),
}));

import AwaitingApprovalPage from "@/app/awaiting-approval/page";

beforeEach(() => {
  mockReplace.mockReset();
  awaitingSearchParamsGet.mockReset();
  awaitingSearchParamsGet.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/awaiting-approval (legacy ADR 0012 redirect)", () => {
  it("redirects to /home when there is no ?next= param", async () => {
    render(<AwaitingApprovalPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
  });

  it("honors a safe ?next= destination", async () => {
    awaitingSearchParamsGet.mockImplementation((k) =>
      k === "next" ? "/groups/g1/chat" : null,
    );
    render(<AwaitingApprovalPage />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/groups/g1/chat"),
    );
  });

  it("ignores an unsafe ?next= and falls back to /home", async () => {
    awaitingSearchParamsGet.mockImplementation((k) =>
      k === "next" ? "https://evil.example" : null,
    );
    render(<AwaitingApprovalPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
  });
});
