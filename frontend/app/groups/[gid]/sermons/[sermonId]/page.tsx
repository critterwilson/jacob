"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";

import { useGroupSermons } from "@/lib/hooks/useGroupSermons";

export default function SermonDetailPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const sermonId = String(
    Array.isArray(params?.sermonId)
      ? params.sermonId[0]
      : (params?.sermonId ?? ""),
  );
  const { sermons, loading, deleteSermon } = useGroupSermons(gid);
  const sermon = useMemo(
    () => sermons.find((s) => s.sermonId === sermonId) ?? null,
    [sermons, sermonId],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }
  if (!sermon) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link
          href={`/groups/${gid}/sermons`}
          className="text-xs text-gray-500"
        >
          ← Sermon archive
        </Link>
        <p className="mt-4 text-sm text-gray-700">Sermon not found.</p>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${sermon.title}"? This is a soft delete.`)) return;
    const ok = await deleteSermon(sermonId);
    if (ok) {
      window.location.assign(`/groups/${gid}/sermons`);
    }
  };

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link
        href={`/groups/${gid}/sermons`}
        className="text-xs text-gray-500"
      >
        ← Sermon archive
      </Link>
      {sermon.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sermon.thumbnail}
          alt=""
          className="mt-4 w-full rounded object-cover"
        />
      )}
      <h1 className="mt-4 text-2xl font-semibold">{sermon.title}</h1>
      <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
        {sermon.preacher && (
          <>
            <dt className="text-gray-500">Preacher</dt>
            <dd>{sermon.preacher}</dd>
          </>
        )}
        {sermon.scripture && (
          <>
            <dt className="text-gray-500">Scripture</dt>
            <dd>{sermon.scripture}</dd>
          </>
        )}
        {sermon.sermonDate && (
          <>
            <dt className="text-gray-500">Date</dt>
            <dd>{new Date(sermon.sermonDate).toLocaleDateString()}</dd>
          </>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={sermon.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
        >
          Open source ↗
        </a>
        {/* T50 will replace this with an inline Watch Together flow.
            Until then, the link above is the path. */}
        <button
          type="button"
          disabled
          title="Watch Together — coming with T50"
          className="cursor-not-allowed rounded border border-gray-300 px-3 py-1 text-sm text-gray-500"
        >
          Watch with the group (coming soon)
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </main>
  );
}
