/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

vi.mock("@/lib/api", () => ({
  apiGetConditional: vi.fn(),
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

import { apiGetConditional as apiGetConditionalExport } from "@/lib/api";
import { IncidentBanner } from "@/components/IncidentBanner";

const apiGetConditional = apiGetConditionalExport as unknown as ReturnType<
  typeof vi.fn
>;

describe("IncidentBanner (T59)", () => {
  beforeEach(() => {
    apiGetConditional.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when no incidents are active", async () => {
    apiGetConditional.mockResolvedValue({ status: 200, data: { incidents: [] }, etag: null });
    const { container } = render(<IncidentBanner />);
    await waitFor(() => expect(apiGetConditional).toHaveBeenCalled());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders the highest severity when multiple are active", async () => {
    apiGetConditional.mockResolvedValue({
      status: 200,
      data: {
        incidents: [
          {
            incidentId: "low",
            severity: "SEV3",
            title: "Background job slow",
            body: "Investigating",
            createdBy: null,
            createdAt: null,
            displayUntil: new Date(Date.now() + 60_000).toISOString(),
            acknowledged: false,
          },
          {
            incidentId: "high",
            severity: "SEV1",
            title: "Sign-in down",
            body: "Investigating",
            createdBy: null,
            createdAt: null,
            displayUntil: new Date(Date.now() + 60_000).toISOString(),
            acknowledged: false,
          },
        ],
      },
      etag: null,
    });
    render(<IncidentBanner />);
    await waitFor(() =>
      expect(screen.getByText(/Sign-in down/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/SEV1/)).toBeInTheDocument();
    // Only one banner is rendered (SEV3 hidden behind SEV1)
    expect(screen.queryByText(/Background job slow/)).toBeNull();
  });

  it("hides itself when the API returns 401", async () => {
    apiGetConditional.mockRejectedValue(
      Object.assign(new Error("unauth"), {
        status: 401,
        code: "unauthenticated",
      }),
    );
    const { container } = render(<IncidentBanner />);
    // Wait a tick for the rejection to settle
    await waitFor(() => expect(apiGetConditional).toHaveBeenCalled());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
