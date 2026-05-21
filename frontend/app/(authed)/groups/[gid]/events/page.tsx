"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import {
  type EventCreatePayload,
  type RsvpStatus,
  useEvents,
} from "@/lib/hooks/useEvents";
import { useAuth } from "@/lib/auth-context";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";

export default function EventsListPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const { events, loading, error, createEvent, rsvp } = useEvents(gid);
  const { user } = useAuth();
  // Backend rejects non-leader POSTs with 403; hide the affordance.
  const { isLeader } = useGroupMembership(user?.uid, gid);

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [recurKind, setRecurKind] = useState<"none" | "weekly" | "biweekly">("none");
  const [recurCount, setRecurCount] = useState(4);
  const [pending, setPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submit = async () => {
    if (!title || !startsAt || !endsAt) return;
    setPending(true);
    setAddError(null);
    const payload: EventCreatePayload = {
      title,
      description,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      location: location || null,
    };
    if (recurKind !== "none") {
      payload.recurrence = { kind: recurKind, count: recurCount };
    }
    const created = await createEvent(payload);
    if (!created) {
      setAddError("Could not create the event. Check the dates.");
      setPending(false);
      return;
    }
    setTitle("");
    setDescription("");
    setStartsAt("");
    setEndsAt("");
    setLocation("");
    setRecurKind("none");
    setShowAdd(false);
    setPending(false);
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <Link
            href={`/groups/${gid}/chat`}
            className="text-xs text-cream-muted hover:text-cream-muted"
          >
            ← Back to group
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Events</h1>
        </div>
        {isLeader && (
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="rounded bg-gold px-3 py-1 text-sm text-ink"
          >
            {showAdd ? "Cancel" : "New event"}
          </button>
        )}
      </header>

      {isLeader && showAdd && (
        <section className="space-y-2 rounded border border-line bg-ink-raised p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-cream-muted">
              Starts
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs text-cream-muted">
              Ends
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
              />
            </label>
          </div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
          <div className="flex items-center gap-2 text-sm">
            <label className="text-xs text-cream-muted">Repeat</label>
            <select
              value={recurKind}
              onChange={(e) =>
                setRecurKind(e.target.value as "none" | "weekly" | "biweekly")
              }
              className="rounded border border-line px-2 py-1 text-sm"
            >
              <option value="none">none</option>
              <option value="weekly">weekly</option>
              <option value="biweekly">biweekly</option>
            </select>
            {recurKind !== "none" && (
              <>
                <label className="ml-2 text-xs text-cream-muted">Count</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={recurCount}
                  onChange={(e) => setRecurCount(Number(e.target.value))}
                  className="w-16 rounded border border-line px-2 py-1 text-sm"
                />
              </>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={submit}
              disabled={pending || !title || !startsAt || !endsAt}
              className="rounded bg-gold px-3 py-1 text-sm text-ink disabled:opacity-40"
            >
              {pending ? "Creating…" : "Create"}
            </button>
            {addError && (
              <span className="text-xs text-terracotta">{addError}</span>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-terracotta">{error.message}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-cream-muted">No events scheduled.</p>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li
              key={event.eventId}
              className="rounded border border-line bg-ink-raised p-3"
            >
              <Link
                href={`/groups/${gid}/events/${event.eventId}`}
                className="text-sm font-medium text-gold hover:underline"
              >
                {event.title}
              </Link>
              <p className="text-xs text-cream-muted">
                {new Date(event.startsAt).toLocaleString()} —{" "}
                {new Date(event.endsAt).toLocaleString()}
              </p>
              {event.location && (
                <p className="text-xs text-cream-muted">📍 {event.location}</p>
              )}
              <div className="mt-2 flex gap-2 text-xs">
                {(["going", "maybe", "no"] as RsvpStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => rsvp(event.eventId, s)}
                    className="rounded border border-line px-2 py-0.5 hover:bg-ink-raised"
                  >
                    {s}
                  </button>
                ))}
                <span className="text-cream-muted">
                  ({event.rsvpGoing} going)
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
