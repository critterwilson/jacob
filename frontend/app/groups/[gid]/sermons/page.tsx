"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  type Sermon,
  useGroupSermons,
} from "@/lib/hooks/useGroupSermons";

export default function SermonsListPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const { sermons, preachers, loading, error, addSermon } = useGroupSermons(gid);

  const [preacherFilter, setPreacherFilter] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newPreacher, setNewPreacher] = useState("");
  const [newScripture, setNewScripture] = useState("");
  const [newDate, setNewDate] = useState("");
  const [pending, setPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!preacherFilter) return sermons;
    return sermons.filter((s) => s.preacher === preacherFilter);
  }, [sermons, preacherFilter]);

  const submit = async () => {
    if (!newUrl) return;
    setPending(true);
    setAddError(null);
    const res = await addSermon({
      sourceUrl: newUrl,
      title: newTitle || undefined,
      preacher: newPreacher || undefined,
      scripture: newScripture || undefined,
      sermonDate: newDate || undefined,
    });
    if (!res) {
      setAddError("Failed to add — check the URL is well-formed.");
      setPending(false);
      return;
    }
    setNewUrl("");
    setNewTitle("");
    setNewPreacher("");
    setNewScripture("");
    setNewDate("");
    setShowAdd(false);
    setPending(false);
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <Link
            href={`/groups/${gid}/chat`}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ← Back to group
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Sermon archive</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
        >
          {showAdd ? "Cancel" : "Add sermon"}
        </button>
      </header>

      {showAdd && (
        <section className="space-y-2 rounded border border-gray-200 bg-white p-4">
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="YouTube URL or podcast link"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title (auto-filled for YouTube)"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              value={newPreacher}
              onChange={(e) => setNewPreacher(e.target.value)}
              placeholder="Preacher"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              value={newScripture}
              onChange={(e) => setNewScripture(e.target.value)}
              placeholder="Scripture (e.g. John 3:16)"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={submit}
              disabled={!newUrl || pending}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
            >
              {pending ? "Adding…" : "Add"}
            </button>
            {addError && (
              <span className="text-xs text-red-600">{addError}</span>
            )}
          </div>
        </section>
      )}

      <div className="flex items-center gap-2 text-sm">
        <label className="text-xs text-gray-500">Preacher:</label>
        <select
          value={preacherFilter}
          onChange={(e) => setPreacherFilter(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">All</option>
          {preachers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error.message}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No sermons yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((sermon) => (
            <SermonRow key={sermon.sermonId} gid={gid} sermon={sermon} />
          ))}
        </ul>
      )}
    </main>
  );
}

function SermonRow({ gid, sermon }: { gid: string; sermon: Sermon }) {
  return (
    <li className="rounded border border-gray-200 bg-white p-3">
      {sermon.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sermon.thumbnail}
          alt=""
          className="mb-2 aspect-video w-full rounded object-cover"
        />
      )}
      <Link
        href={`/groups/${gid}/sermons/${sermon.sermonId}`}
        className="text-sm font-medium text-blue-700 hover:underline"
      >
        {sermon.title}
      </Link>
      <p className="text-xs text-gray-500">
        {[sermon.preacher, sermon.scripture, sermon.sermonDate]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </li>
  );
}
