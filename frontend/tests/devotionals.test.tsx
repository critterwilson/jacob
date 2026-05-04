/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  firestore: {},
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
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

import {
  apiGet as apiGetExport,
  apiPost as apiPostExport,
} from "@/lib/api";
import {
  useDevotional,
  useDevotionals,
} from "@/lib/hooks/useDevotionals";
import {
  usePlanProgress,
  useReadingPlan,
  useReadingPlans,
} from "@/lib/hooks/useReadingPlans";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;

describe("devotionals + reading-plan hooks (T51)", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  it("useDevotionals fetches the list", async () => {
    apiGet.mockResolvedValue({
      devotionals: [
        {
          slug: "psalm-23",
          title: "The Lord is My Shepherd",
          scriptureRef: "Ps 23",
          body: "...",
          audioUrl: null,
          sourceAttribution: "PD",
          publishedAt: null,
          audience: "christian",
        },
      ],
    });
    const { result } = renderHook(() => useDevotionals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devotionals).toHaveLength(1);
  });

  it("useDevotional 404 → null", async () => {
    apiGet.mockRejectedValue(
      Object.assign(new Error("nope"), { status: 404, code: "not_found" }),
    );
    const { result } = renderHook(() => useDevotional("missing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devotional).toBeNull();
  });

  it("useReadingPlans fetches the summary list (no days)", async () => {
    apiGet.mockResolvedValue({
      plans: [
        {
          slug: "john",
          title: "John 21",
          description: "21 days",
          duration: 21,
          audience: "christian",
          publishedAt: null,
        },
      ],
    });
    const { result } = renderHook(() => useReadingPlans());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plans[0].duration).toBe(21);
  });

  it("useReadingPlan returns the day list", async () => {
    apiGet.mockResolvedValue({
      slug: "john",
      title: "John",
      description: "21 days",
      duration: 21,
      audience: "christian",
      publishedAt: null,
      days: [
        { dayNumber: 1, scriptureRef: "John 1", prompt: "Reflect" },
      ],
    });
    const { result } = renderHook(() => useReadingPlan("john"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan?.days).toHaveLength(1);
  });

  it("usePlanProgress.markComplete posts and updates state", async () => {
    apiGet.mockResolvedValue({
      planSlug: "john",
      startedAt: null,
      completedDays: [],
      streak: 0,
      lastCompletedAt: null,
    });
    apiPost.mockResolvedValue({
      planSlug: "john",
      completedDays: [1],
      streak: 1,
      lastCompletedAt: "2026-05-04T00:00:00+00:00",
    });
    const { result } = renderHook(() => usePlanProgress("john"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const after = await result.current.markComplete(1);
    expect(after?.streak).toBe(1);
    expect(apiPost).toHaveBeenCalledWith(
      "/api/reading-plans/john/progress/mark",
      { dayNumber: 1 },
    );
  });
});
