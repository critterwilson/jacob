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
import { useEvents } from "@/lib/hooks/useEvents";

const apiGet = apiGetExport as unknown as ReturnType<typeof vi.fn>;
const apiPost = apiPostExport as unknown as ReturnType<typeof vi.fn>;
const apiDelete = apiDeleteExport as unknown as ReturnType<typeof vi.fn>;

describe("useEvents (T49)", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
  });

  it("fetches events on mount", async () => {
    apiGet.mockResolvedValue({
      events: [
        {
          eventId: "e1",
          title: "Prayer",
          description: "",
          startsAt: "2026-05-10T18:00:00Z",
          endsAt: "2026-05-10T19:00:00Z",
          location: null,
          recurrence: null,
          parentEventId: null,
          occurrenceIndex: 0,
          createdBy: "leader-1",
          createdAt: null,
          deletedAt: null,
          reminderSentAt: null,
          rsvpGoing: 2,
          rsvpMaybe: 0,
          rsvpNo: 1,
          attendedCount: 0,
        },
      ],
    });
    const { result } = renderHook(() => useEvents("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].rsvpGoing).toBe(2);
  });

  it("createEvent posts and reloads", async () => {
    apiGet.mockResolvedValue({ events: [] });
    apiPost.mockResolvedValue({
      eventId: "e1",
      title: "T",
      description: "",
      startsAt: "2026-05-10T18:00:00Z",
      endsAt: "2026-05-10T19:00:00Z",
      location: null,
      recurrence: null,
      parentEventId: null,
      occurrenceIndex: 0,
      createdBy: "leader-1",
      createdAt: null,
      deletedAt: null,
      reminderSentAt: null,
      rsvpGoing: 0,
      rsvpMaybe: 0,
      rsvpNo: 0,
      attendedCount: 0,
    });
    const { result } = renderHook(() => useEvents("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const created = await result.current.createEvent({
      title: "T",
      startsAt: "2026-05-10T18:00:00Z",
      endsAt: "2026-05-10T19:00:00Z",
    });
    expect(created?.eventId).toBe("e1");
    expect(apiPost).toHaveBeenCalledWith(
      "/api/groups/g1/events",
      expect.objectContaining({ title: "T" }),
    );
  });

  it("rsvp posts the right path/body", async () => {
    apiGet.mockResolvedValue({ events: [] });
    apiPost.mockResolvedValue({});
    const { result } = renderHook(() => useEvents("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ok = await result.current.rsvp("e1", "going");
    expect(ok).toBe(true);
    expect(apiPost).toHaveBeenCalledWith(
      "/api/groups/g1/events/e1/rsvp",
      { status: "going" },
    );
  });

  it("deleteEvent posts to delete endpoint", async () => {
    apiGet.mockResolvedValue({ events: [] });
    apiDelete.mockResolvedValue({});
    const { result } = renderHook(() => useEvents("g1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ok = await result.current.deleteEvent("e1");
    expect(ok).toBe(true);
    expect(apiDelete).toHaveBeenCalledWith("/api/groups/g1/events/e1");
  });
});
