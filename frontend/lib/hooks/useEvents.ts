"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

export type Recurrence = { kind: "weekly" | "biweekly"; count: number };

export type Event = {
  eventId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  recurrence: Recurrence | null;
  parentEventId: string | null;
  occurrenceIndex: number;
  createdBy: string;
  createdAt: string | null;
  deletedAt: string | null;
  reminderSentAt: string | null;
  rsvpGoing: number;
  rsvpMaybe: number;
  rsvpNo: number;
  attendedCount: number;
};

export type EventCreatePayload = {
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  recurrence?: Recurrence | null;
};

export type EventUpdatePayload = {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string | null;
};

export type RsvpStatus = "going" | "maybe" | "no";

export type Rsvp = {
  uid: string;
  status: RsvpStatus;
  respondedAt: string | null;
  attended: boolean | null;
  checkedInAt: string | null;
};

export function useEvents(gid: string | null | undefined): {
  events: Event[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  createEvent: (payload: EventCreatePayload) => Promise<Event | null>;
  updateEvent: (eventId: string, payload: EventUpdatePayload) => Promise<Event | null>;
  deleteEvent: (eventId: string) => Promise<boolean>;
  rsvp: (eventId: string, status: RsvpStatus) => Promise<boolean>;
  checkIn: (eventId: string) => Promise<boolean>;
  listRsvps: (eventId: string) => Promise<Rsvp[]>;
  markAttendance: (eventId: string, uid: string, attended: boolean) => Promise<boolean>;
} {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(Boolean(gid));
  const [error, setError] = useState<ApiError | null>(null);
  const [token, setToken] = useState(0);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    if (!gid) {
      setEvents([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<{ events: Event[] }>(
      `/api/groups/${encodeURIComponent(gid)}/events`,
      { signal: ctrl.signal },
    )
      .then((res) => {
        setEvents(res.events);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setEvents([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [gid, token]);

  const createEvent = useCallback(
    async (payload: EventCreatePayload): Promise<Event | null> => {
      if (!gid) return null;
      try {
        const res = await apiPost<Event>(
          `/api/groups/${encodeURIComponent(gid)}/events`,
          payload,
        );
        reload();
        return res;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("event_create_failed", err.code, err.status);
        }
        return null;
      }
    },
    [gid, reload],
  );

  const deleteEvent = useCallback(
    async (eventId: string): Promise<boolean> => {
      if (!gid) return false;
      try {
        await apiDelete(
          `/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(eventId)}`,
        );
        reload();
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("event_delete_failed", err.code, err.status);
        }
        return false;
      }
    },
    [gid, reload],
  );

  const rsvp = useCallback(
    async (eventId: string, status: RsvpStatus): Promise<boolean> => {
      if (!gid) return false;
      try {
        await apiPost(
          `/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(eventId)}/rsvp`,
          { status },
        );
        reload();
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("event_rsvp_failed", err.code, err.status);
        }
        return false;
      }
    },
    [gid, reload],
  );

  const checkIn = useCallback(
    async (eventId: string): Promise<boolean> => {
      if (!gid) return false;
      try {
        await apiPost(
          `/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(eventId)}/check-in`,
          {},
        );
        reload();
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("event_checkin_failed", err.code, err.status);
        }
        return false;
      }
    },
    [gid, reload],
  );

  const updateEvent = useCallback(
    async (eventId: string, payload: EventUpdatePayload): Promise<Event | null> => {
      if (!gid) return null;
      try {
        const res = await apiPatch<Event>(
          `/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(eventId)}`,
          payload,
        );
        reload();
        return res;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("event_update_failed", err.code, err.status);
        }
        return null;
      }
    },
    [gid, reload],
  );

  const listRsvps = useCallback(
    async (eventId: string): Promise<Rsvp[]> => {
      if (!gid) return [];
      try {
        const res = await apiGet<{ rsvps: Rsvp[] }>(
          `/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(eventId)}/rsvps`,
        );
        return res.rsvps;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("event_rsvps_failed", err.code, err.status);
        }
        return [];
      }
    },
    [gid],
  );

  const markAttendance = useCallback(
    async (eventId: string, uid: string, attended: boolean): Promise<boolean> => {
      if (!gid) return false;
      try {
        await apiPost(
          `/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(eventId)}/manual-attendance`,
          { uid, attended },
        );
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("event_attendance_failed", err.code, err.status);
        }
        return false;
      }
    },
    [gid],
  );

  return {
    events,
    loading,
    error,
    reload,
    createEvent,
    updateEvent,
    deleteEvent,
    rsvp,
    checkIn,
    listRsvps,
    markAttendance,
  };
}
