"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, ButtonLink } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useEvents, type EventUpdatePayload, type Rsvp, type RsvpStatus } from "@/lib/hooks/useEvents";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useMembers } from "@/lib/hooks/useMembers";

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

  const { user } = useAuth();
  const { isLeader } = useGroupMembership(user?.uid, gid);
  const { events, loading, rsvp, checkIn, deleteEvent, updateEvent, listRsvps, markAttendance } = useEvents(gid);
  const { members } = useMembers(gid);

  const event = useMemo(
    () => events.find((e) => e.eventId === eventId) ?? null,
    [events, eventId],
  );

  const [actionInfo, setActionInfo] = useState<string | null>(null);

  // Edit form state
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");
  const [editPending, setEditPending] = useState(false);

  // RSVP list state (leader only)
  const [rsvpList, setRsvpList] = useState<Rsvp[] | null>(null);
  const [rsvpListLoading, setRsvpListLoading] = useState(false);

  // Seed edit form when event loads or edit is opened
  useEffect(() => {
    if (event && showEdit) {
      setEditTitle(event.title);
      setEditDescription(event.description);
      setEditLocation(event.location ?? "");
      // Convert ISO string to datetime-local value (strip seconds + Z)
      setEditStartsAt(toLocalInput(event.startsAt));
      setEditEndsAt(toLocalInput(event.endsAt));
    }
  }, [event, showEdit]);

  // Load RSVP list when leader opens detail
  useEffect(() => {
    if (!isLeader || !eventId || !gid) return;
    setRsvpListLoading(true);
    listRsvps(eventId).then((rows) => {
      setRsvpList(rows);
      setRsvpListLoading(false);
    });
  }, [isLeader, eventId, gid, listRsvps]);

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

  const submitEdit = async () => {
    if (!editTitle) return;
    setEditPending(true);
    const payload: EventUpdatePayload = {};
    if (editTitle !== event.title) payload.title = editTitle;
    if (editDescription !== event.description) payload.description = editDescription;
    if (editLocation !== (event.location ?? "")) payload.location = editLocation || null;
    if (editStartsAt) payload.startsAt = new Date(editStartsAt).toISOString();
    if (editEndsAt) payload.endsAt = new Date(editEndsAt).toISOString();
    const updated = await updateEvent(eventId, payload);
    setEditPending(false);
    if (updated) {
      setShowEdit(false);
      setActionInfo("Event updated.");
    } else {
      setActionInfo("Update failed — check the dates.");
    }
  };

  const nameFor = (uid: string) =>
    members.find((m) => m.uid === uid)?.displayName ?? uid;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href={`/groups/${gid}/events`} className="text-xs text-cream-muted">
        ← Events
      </Link>
      <header className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{event.title}</h1>
          <p className="text-sm text-cream-muted">
            {startsAt.toLocaleString()} — {new Date(event.endsAt).toLocaleString()}
          </p>
          {event.location && (
            <p className="text-sm text-cream-muted">📍 {event.location}</p>
          )}
        </div>
        {isLeader && (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowEdit((s) => !s)}
            >
              {showEdit ? "Cancel" : "Edit"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!confirm("Delete this event (and recurrence children)?")) return;
                const ok = await deleteEvent(event.eventId);
                if (ok) window.location.assign(`/groups/${gid}/events`);
                else setActionInfo("Delete failed.");
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </header>

      {/* Edit form — leader only */}
      {isLeader && showEdit && (
        <section
          aria-label="Edit event"
          className="mt-4 space-y-2 rounded border border-line bg-ink-raised p-4"
        >
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Description"
            rows={2}
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
          <input
            value={editLocation}
            onChange={(e) => setEditLocation(e.target.value)}
            placeholder="Location (optional)"
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-cream-muted">
              Starts
              <input
                type="datetime-local"
                value={editStartsAt}
                onChange={(e) => setEditStartsAt(e.target.value)}
                className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs text-cream-muted">
              Ends
              <input
                type="datetime-local"
                value={editEndsAt}
                onChange={(e) => setEditEndsAt(e.target.value)}
                className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="primary"
              fullWidth="mobile"
              onClick={submitEdit}
              loading={editPending}
              disabled={editPending || !editTitle}
            >
              {editPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </section>
      )}

      {event.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-cream">
          {event.description}
        </p>
      )}

      {/* RSVP control — all members */}
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

      {/* Member actions */}
      <section className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={async () => {
            const ok = await checkIn(event.eventId);
            setActionInfo(
              ok
                ? "Checked in!"
                : "Outside the check-in window (±15 min around the start).",
            );
          }}
          disabled={!checkInOpen}
          title={
            checkInOpen
              ? "I'm here"
              : "Check-in opens 15 min before the event starts."
          }
        >
          {checkInOpen ? "I'm here" : "Check-in not open"}
        </Button>
        <ButtonLink
          href={`${API}/api/groups/${encodeURIComponent(gid)}/events/${encodeURIComponent(event.eventId)}.ics`}
          variant="secondary"
        >
          Add to calendar
        </ButtonLink>
      </section>

      {/* Leader: RSVP roster + attendance */}
      {isLeader && (
        <section
          aria-label="Attendance roster"
          className="mt-8 space-y-3"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cream-muted">
            Roster
          </h2>
          {rsvpListLoading ? (
            <p className="text-sm text-cream-muted">Loading roster…</p>
          ) : !rsvpList || rsvpList.length === 0 ? (
            <p className="text-sm text-cream-muted">No RSVPs yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="rsvp-roster">
              {rsvpList.map((r) => (
                <RsvpRow
                  key={r.uid}
                  rsvp={r}
                  name={nameFor(r.uid)}
                  onToggleAttendance={async (attended) => {
                    const ok = await markAttendance(eventId, r.uid, attended);
                    if (ok) {
                      setRsvpList((prev) =>
                        prev
                          ? prev.map((x) =>
                              x.uid === r.uid ? { ...x, attended } : x,
                            )
                          : prev,
                      );
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {actionInfo && (
        <p className="mt-3 text-xs text-cream-muted">{actionInfo}</p>
      )}
    </main>
  );
}

function RsvpRow({
  rsvp,
  name,
  onToggleAttendance,
}: {
  rsvp: Rsvp;
  name: string;
  onToggleAttendance: (attended: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  const statusLabel: Record<string, string> = {
    going: "Going",
    maybe: "Maybe",
    no: "Not going",
  };

  return (
    <li className="flex items-center justify-between rounded border border-line bg-ink-raised px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{name}</span>
        <span className="ml-2 text-xs text-cream-muted">
          {statusLabel[rsvp.status] ?? rsvp.status}
        </span>
      </div>
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-cream-muted">
        <input
          type="checkbox"
          checked={rsvp.attended === true}
          disabled={pending}
          onChange={async (e) => {
            setPending(true);
            await onToggleAttendance(e.target.checked);
            setPending(false);
          }}
          className="h-4 w-4"
        />
        Attended
      </label>
    </li>
  );
}

function toLocalInput(iso: string): string {
  try {
    const d = new Date(iso);
    // datetime-local expects "YYYY-MM-DDTHH:mm"
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  } catch {
    return "";
  }
}
