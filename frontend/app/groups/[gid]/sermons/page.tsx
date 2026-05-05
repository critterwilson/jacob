"use client";

import { useParams } from "next/navigation";
import NextLink from "next/link";
import { useMemo, useState } from "react";

import { OpenBook } from "@/components/motifs/OpenBook";
import {
  Banner,
  Button,
  Card,
  Eyebrow,
  Heading,
  Link,
  Section,
  Select,
} from "@/components/ui";
import {
  type Sermon,
  useGroupSermons,
} from "@/lib/hooks/useGroupSermons";

const inputClass =
  "w-full rounded border border-line bg-ink-overlay px-3 py-2 " +
  "font-sans text-body-sm text-cream placeholder:text-cream-dim " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

export default function SermonsListPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const { sermons, preachers, loading, error, addSermon } =
    useGroupSermons(gid);

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
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Link
        href={`/groups/${gid}/chat`}
        variant="muted"
        className="text-caption"
      >
        ← Back to group
      </Link>

      <header className="flex items-end justify-between gap-6">
        <div className="flex items-center gap-5">
          <OpenBook className="h-14 w-auto shrink-0 text-gold-soft opacity-90" />
          <div className="space-y-1">
            <Eyebrow>Group library</Eyebrow>
            <Heading level={1} size="md">
              Sermon archive
            </Heading>
          </div>
        </div>
        <Button
          type="button"
          variant={showAdd ? "secondary" : "primary"}
          size="md"
          onClick={() => setShowAdd((s) => !s)}
        >
          {showAdd ? "Cancel" : "Add sermon"}
        </Button>
      </header>

      {showAdd && (
        <Section title="Add a sermon" description="Paste a YouTube URL or podcast link. Title is auto-filled when possible.">
          <div className="space-y-2">
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="YouTube URL or podcast link"
              className={inputClass}
            />
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (auto-filled for YouTube)"
              className={inputClass}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                value={newPreacher}
                onChange={(e) => setNewPreacher(e.target.value)}
                placeholder="Preacher"
                className={inputClass}
              />
              <input
                value={newScripture}
                onChange={(e) => setNewScripture(e.target.value)}
                placeholder="Scripture (e.g. John 3:16)"
                className={inputClass}
              />
              <input
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                placeholder="YYYY-MM-DD"
                className={inputClass}
              />
            </div>
          </div>

          {addError && <Banner tone="error">{addError}</Banner>}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={submit}
              loading={pending}
              disabled={!newUrl || pending}
            >
              {pending ? "Adding…" : "Add"}
            </Button>
          </div>
        </Section>
      )}

      <div className="flex items-center gap-3">
        <Select
          label="Preacher"
          hideLabel
          value={preacherFilter}
          onChange={(e) => setPreacherFilter(e.target.value)}
          className="w-48"
        >
          <option value="">All preachers</option>
          {preachers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading…</p>
      ) : error ? (
        <Banner tone="error">{error.message}</Banner>
      ) : filtered.length === 0 ? (
        <p className="text-body-sm text-cream-muted">No sermons yet.</p>
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
    <li>
      <NextLink
        href={`/groups/${gid}/sermons/${sermon.sermonId}`}
        className="block rounded-lg focus:outline-none focus-visible:shadow-glow-gold"
      >
        <Card surface="raised" interactive padding="sm" className="space-y-2">
          {sermon.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sermon.thumbnail}
              alt=""
              className="aspect-video w-full rounded-md border border-line object-cover"
            />
          )}
          <h3 className="font-display text-display-sm text-cream">
            {sermon.title}
          </h3>
          <p className="text-caption text-cream-muted">
            {[sermon.preacher, sermon.scripture, sermon.sermonDate]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Card>
      </NextLink>
    </li>
  );
}
