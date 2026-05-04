/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: {}, rtdb: {} }));
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
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

import { apiGet as apiGetExport } from "@/lib/api";
import { useOrgAnalytics } from "@/lib/hooks/useOrgAnalytics";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;

describe("useOrgAnalytics (T60)", () => {
  beforeEach(() => apiGet.mockReset());

  it("fetches the org analytics payload", async () => {
    apiGet.mockResolvedValue({
      orgId: "o1",
      range: "30d",
      groupCount: 2,
      activeMembers: 5,
      totalMessages: 100,
      eventAttendance: [],
      sentimentTrend: [],
      groups: [],
      generatedAt: "2026-05-04T00:00:00Z",
    });
    const { result } = renderHook(() => useOrgAnalytics("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.groupCount).toBe(2);
    expect(apiGet).toHaveBeenCalledWith(
      "/api/orgs/o1/analytics?range=30d",
      expect.anything(),
    );
  });

  it("honors the range query param", async () => {
    apiGet.mockResolvedValue({
      orgId: "o1",
      range: "7d",
      groupCount: 1,
      activeMembers: 2,
      totalMessages: 10,
      eventAttendance: [],
      sentimentTrend: [],
      groups: [],
      generatedAt: "2026-05-04T00:00:00Z",
    });
    renderHook(() => useOrgAnalytics("o1", "7d"));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet).toHaveBeenCalledWith(
      "/api/orgs/o1/analytics?range=7d",
      expect.anything(),
    );
  });
});
