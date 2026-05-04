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
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
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
  apiDelete as apiDeleteExport,
  apiGet as apiGetExport,
  apiPost as apiPostExport,
} from "@/lib/api";
import { useGroupSermons } from "@/lib/hooks/useGroupSermons";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;
const apiDelete = apiDeleteExport as unknown as ReturnType<typeof vi.fn>;

describe("useGroupSermons (T52)", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
  });

  it("loads sermons + preachers", async () => {
    apiGet.mockResolvedValue({
      sermons: [
        {
          sermonId: "s1",
          title: "Sermon",
          preacher: "Pastor Jane",
          scripture: null,
          sermonDate: null,
          sourceUrl: "https://example.com",
          sourceType: "other",
          thumbnail: null,
          addedBy: "u1",
          addedAt: null,
          deletedAt: null,
        },
      ],
      preachers: ["Pastor Jane"],
    });
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sermons).toHaveLength(1);
    expect(result.current.preachers).toEqual(["Pastor Jane"]);
  });

  it("addSermon posts and reloads", async () => {
    apiGet.mockResolvedValue({ sermons: [], preachers: [] });
    apiPost.mockResolvedValue({
      sermonId: "s1",
      title: "S",
      preacher: null,
      scripture: null,
      sermonDate: null,
      sourceUrl: "https://example.com",
      sourceType: "other",
      thumbnail: null,
      addedBy: "u1",
      addedAt: null,
      deletedAt: null,
    });
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const created = await result.current.addSermon({
      sourceUrl: "https://example.com",
    });
    expect(created?.sermonId).toBe("s1");
    expect(apiPost).toHaveBeenCalledWith("/api/groups/g1/sermons", {
      sourceUrl: "https://example.com",
    });
  });

  it("deleteSermon resolves true on success", async () => {
    apiGet.mockResolvedValue({ sermons: [], preachers: [] });
    apiDelete.mockResolvedValue({});
    const { result } = renderHook(() => useGroupSermons("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(await result.current.deleteSermon("s1")).toBe(true);
    expect(apiDelete).toHaveBeenCalledWith("/api/groups/g1/sermons/s1");
  });
});
