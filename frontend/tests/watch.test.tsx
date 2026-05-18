/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
  rtdb: { __mock: "rtdb" },
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
  startWatchSession,
  useActiveWatchSessions,
  useWatchSession,
} from "@/lib/hooks/useWatchSession";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;

// FEATURE PARKED 2026-05-17: Watch Together deferred by ministry owner.
// Re-enable this suite when T50 is revived. See docs/follow-ups/phase-3-parked.md § T50.
describe.skip("Watch Together hooks (T50)", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  it("useActiveWatchSessions fetches the active list", async () => {
    apiGet.mockResolvedValue({
      sessions: [
        {
          sessionId: "s1",
          videoId: "abc12345",
          sourceUrl: "https://youtu.be/abc12345",
          title: "T",
          thumbnailUrl: null,
          leaderUid: "alice",
          createdBy: "alice",
          createdAt: null,
          endedAt: null,
          attendees: ["alice"],
          durationSec: null,
        },
      ],
    });
    const { result } = renderHook(() => useActiveWatchSessions("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(1);
  });

  it("useWatchSession.join posts to /join", async () => {
    apiGet.mockResolvedValue({
      sessionId: "s1",
      videoId: "abc12345",
      sourceUrl: "https://youtu.be/abc12345",
      title: "T",
      thumbnailUrl: null,
      leaderUid: "alice",
      createdBy: "alice",
      createdAt: null,
      endedAt: null,
      attendees: ["alice"],
      durationSec: null,
    });
    apiPost.mockResolvedValue({});
    const { result } = renderHook(() => useWatchSession("g1", "s1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ok = await result.current.join();
    expect(ok).toBe(true);
    expect(apiPost).toHaveBeenCalledWith(
      "/api/groups/g1/watch/s1/join",
      {},
    );
  });

  it("useWatchSession.transfer posts new leader uid", async () => {
    apiGet.mockResolvedValue({
      sessionId: "s1",
      videoId: "abc12345",
      sourceUrl: "https://youtu.be/abc12345",
      title: null,
      thumbnailUrl: null,
      leaderUid: "alice",
      createdBy: "alice",
      createdAt: null,
      endedAt: null,
      attendees: ["alice", "bob"],
      durationSec: null,
    });
    apiPost.mockResolvedValue({});
    const { result } = renderHook(() => useWatchSession("g1", "s1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ok = await result.current.transfer("bob");
    expect(ok).toBe(true);
    expect(apiPost).toHaveBeenCalledWith(
      "/api/groups/g1/watch/s1/transfer",
      { newLeaderUid: "bob" },
    );
  });

  it("startWatchSession posts and returns session id", async () => {
    apiPost.mockResolvedValue({
      sessionId: "s1",
      videoId: "abc12345",
      title: "T",
      thumbnailUrl: null,
    });
    const created = await startWatchSession(
      "g1",
      "https://www.youtube.com/watch?v=abc12345",
    );
    expect(created?.sessionId).toBe("s1");
    expect(apiPost).toHaveBeenCalledWith("/api/groups/g1/watch/start", {
      videoUrl: "https://www.youtube.com/watch?v=abc12345",
    });
  });
});
