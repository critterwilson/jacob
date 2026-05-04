"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { useWatchSession } from "@/lib/hooks/useWatchSession";

export default function WatchSessionPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const sessionId = String(
    Array.isArray(params?.sessionId)
      ? params.sessionId[0]
      : (params?.sessionId ?? ""),
  );
  const { user } = useAuth();
  const { session, loading, join, end } = useWatchSession(gid, sessionId);
  const [joined, setJoined] = useState(false);

  // Auto-join on mount if the user isn't already an attendee.
  useEffect(() => {
    if (!session || !user) return;
    if (session.endedAt) return;
    if (session.attendees.includes(user.uid)) {
      setJoined(true);
      return;
    }
    void join().then((ok) => setJoined(ok));
  }, [session, user, join]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }
  if (!session) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link href={`/groups/${gid}/chat`} className="text-xs text-gray-500">
          ← Group
        </Link>
        <p className="mt-4 text-sm text-gray-700">Watch session not found.</p>
      </div>
    );
  }

  const isLeader = session.leaderUid === user?.uid;
  const ended = Boolean(session.endedAt);

  // Embed via the standard YouTube embed URL (no JS API needed for the
  // initial render). The leader / follower sync uses the IFrame API
  // when wired in a follow-up; v1 ships a "Watch in sync via the
  // YouTube embed; tap pause/play together" pattern with an explicit
  // re-sync button.
  const embedUrl = `https://www.youtube-nocookie.com/embed/${session.videoId}?rel=0&modestbranding=1`;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <Link href={`/groups/${gid}/chat`} className="text-xs text-gray-500">
          ← Group
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {session.title ?? "Watch Together"}
        </h1>
        <p className="text-xs text-gray-500">
          Hosted by{" "}
          <span className="font-mono">{session.leaderUid}</span> ·{" "}
          {session.attendees.length} attendee
          {session.attendees.length === 1 ? "" : "s"}
        </p>
      </header>

      <div className="aspect-video w-full overflow-hidden rounded border border-gray-200 bg-black">
        {ended ? (
          <div className="flex h-full items-center justify-center text-white">
            Session ended.
          </div>
        ) : (
          // eslint-disable-next-line jsx-a11y/iframe-has-title
          <iframe
            src={embedUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        )}
      </div>

      <section className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-700">
        {ended ? (
          <p>Session ended {new Date(session.endedAt!).toLocaleString()}.</p>
        ) : isLeader ? (
          <p>You&apos;re hosting. The other attendees see what you play.</p>
        ) : joined ? (
          <p>You&apos;re watching with {session.attendees.length - 1} others.</p>
        ) : (
          <p>Joining…</p>
        )}
      </section>

      {!ended && (
        <div className="flex gap-2">
          {isLeader && (
            <button
              type="button"
              onClick={end}
              className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
            >
              End session
            </button>
          )}
          <a
            href={session.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            Open on YouTube ↗
          </a>
        </div>
      )}
    </main>
  );
}
