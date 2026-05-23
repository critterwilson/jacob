/**
 * Watch Together session page (T50) — FEATURE PARKED 2026-05-17.
 *
 * The ministry owner has deferred all video features. This page now
 * shows a "not available" message so any bookmarked or shared /watch/*
 * URLs land gracefully rather than crashing.
 *
 * The component, hook, and service code remain in the tree so the
 * feature can be revived without a rebuild from scratch. To re-enable:
 *   1. Set feature_flags/watch_sessions.enabled = true in Firestore.
 *   2. Restore this file from git (the pre-parking version is in git
 *      history as of the chore/park-watch-sessions commit).
 *   3. Restore the nav entries and re-enable the skipped tests.
 * See docs/follow-ups/phase-3-parked.md § T50 for full instructions.
 */
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function WatchSessionPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href={`/groups/${gid}/chat`} className="text-xs text-cream-muted">
        ← Group
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Watch Together</h1>
      <p className="text-sm text-cream-muted">
        Watch Together is coming soon. In the meantime, head over to the{" "}
        <Link
          href={`/groups/${gid}/sermons`}
          className="text-gold-soft underline-offset-2 hover:underline"
        >
          sermon archive
        </Link>{" "}
        to watch what your group has shared.
      </p>
    </main>
  );
}
