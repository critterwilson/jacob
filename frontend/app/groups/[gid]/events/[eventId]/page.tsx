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
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }
  if (!event) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link href={`/groups/${gid}/events`} className="text-xs text-gray-500">
          ← Events
        </Link>
        <p className="mt-4 text-sm text-gray-700">Event not found.</p>
      </div>
    );
  }

  const startsAt = new Date(event.startsAt);
  const now = new Date();
  const checkInOpen =
    Math.abs(now.getTime() - startsAt.getTime()) <= 15 * 60 * 1000;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href={`/groups/${gid}/events`} className="text-xs text-gray-500">
        ← Events
      </Link>
      <header className="mt-3">
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        <p className="text-sm text-gray-600">
          {startsAt.toLocaleString()} — {new Date(event.endsAt).toLocaleString()}
        </p>
        {event.location && (
          <p className="text-sm text-gray-600">📍 {event.location}</p>
        )}
      </header>

      {event.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-gray-800">
          {event.description}
        </p>
      )}

      <section className="mt-6 space-y-2 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
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
              className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
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
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
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
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
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
          className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </section>

      {actionInfo && (
        <p className="mt-3 text-xs text-gray-500">{actionInfo}</p>
      )}
    </main>
  );
}
