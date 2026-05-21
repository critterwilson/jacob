"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useEvents, type RsvpStatus } from "@/lib/hooks/useEvents";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function EventDetailPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const eventId = String(
    Array.isArray(params?.eventId)
      ? params.eventId[0]
      : (params?.eventId ?? ""),
  );
  const { events, loading, rsvp, checkIn, deleteEvent } = useEvents(gid);
  const event = useMemo(
    () => events.find((e) => e.eventId === eventId) ?? null,
    [events, eventId],
  );
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-cream-muted">
        Loading…
      </div>
    );
  }
  if (!event) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link href={`/groups/${gid}/events`} className="text-xs text-cream-muted">
          ← Events
        </Link>
        <p className="mt-4 text-sm text-cream-muted">Event not found.</p>
      </div>
    );
  }

  const startsAt = new Date(event.startsAt);
  const now = new Date();
  const checkInOpen =
    Math.abs(now.getTime() - startsAt.getTime()) <= 15 * 60 * 1000;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href={`/groups/${gid}/events`} className="text-xs text-cream-muted">
        ← Events
      </Link>
      <header className="mt-3">
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        <p className="text-sm text-cream-muted">
          {startsAt.toLocaleString()} — {new Date(event.endsAt).toLocaleString()}
        </p>
        {event.location && (
          <p className="text-sm text-cream-muted">📍 {event.location}</p>
        )}
      </header>

      {event.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-cream">
          {event.description}
        </p>
      )}

      <section className="mt-6 space-y-2 rounded border border-line bg-ink-raised p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cream-muted">
          RSVP
        </h2>
        <div className="flex flex-wrap gap-2">
          {(["going", "maybe", "no"] as RsvpStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={async () => {
                const ok = await rsvp(event.eventId, s);
                setActionInfo(ok ? `RSVP set to ${s}` : "RSVP failed");
              }}
              className="rounded border border-line px-3 py-1 text-sm hover:bg-ink-raised"
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-cream-muted">
          {event.rsvpGoing} going · {event.rsvpMaybe} maybe · {event.rsvpNo} no
          · {event.attendedCount} attended
        </p>
      </section>

      <section className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            const ok = await checkIn(event.eventId);
            setActionInfo(
              ok
                ? "Checked in!"
                : "Outside the check-in window (±15 min around the start).",
            );
          }}
          disabled={!checkInOpen}
          className="rounded bg-gold px-3 py-1 text-sm text-ink disabled:opacity-40"
          title={
            checkInOpen
              ? "I'm here"
              : "Check-in opens 15 min before the event starts."
          }
        >
          {checkInOpen ? "I'm here" : "Check-in not open"}
        </button>
        <a
          href={`${API}/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(event.eventId)}.ics`}
          className="rounded border border-line px-3 py-1 text-sm hover:bg-ink-raised"
        >
          Add to calendar
        </a>
        <button
          type="button"
          onClick={async () => {
            if (!confirm("Soft-delete this event (and recurrence children)?"))
              return;
            const ok = await deleteEvent(event.eventId);
            if (ok) window.location.assign(`/groups/${gid}/events`);
          }}
          className="rounded border border-terracotta/40 px-3 py-1 text-sm text-terracotta hover:bg-terracotta/10"
        >
          Delete
        </button>
      </section>

      {actionInfo && (
        <p className="mt-3 text-xs text-cream-muted">{actionInfo}</p>
      )}
    </main>
  );
}
