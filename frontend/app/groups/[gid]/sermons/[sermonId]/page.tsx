"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";

import { Button, Eyebrow, Heading, Link } from "@/components/ui";
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
      <div className="flex min-h-screen items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }
  if (!sermon) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-3">
        <Link
          href={`/groups/${gid}/sermons`}
          variant="muted"
          className="text-caption"
        >
          ← Sermon archive
        </Link>
        <p className="text-body-sm text-cream">Sermon not found.</p>
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
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <Link
        href={`/groups/${gid}/sermons`}
        variant="muted"
        className="text-caption"
      >
        ← Sermon archive
      </Link>

      {sermon.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sermon.thumbnail}
          alt=""
          className="w-full rounded-lg border border-line object-cover"
        />
      )}

      <header className="space-y-2">
        <Eyebrow>Sermon</Eyebrow>
        <Heading level={1} size="lg">
          {sermon.title}
        </Heading>
      </header>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-body-sm">
        {sermon.preacher && (
          <>
            <dt className="text-eyebrow uppercase tracking-wider text-cream-muted">
              Preacher
            </dt>
            <dd className="text-cream">{sermon.preacher}</dd>
          </>
        )}
        {sermon.scripture && (
          <>
            <dt className="text-eyebrow uppercase tracking-wider text-cream-muted">
              Scripture
            </dt>
            <dd className="text-gold-soft">{sermon.scripture}</dd>
          </>
        )}
        {sermon.sermonDate && (
          <>
            <dt className="text-eyebrow uppercase tracking-wider text-cream-muted">
              Date
            </dt>
            <dd className="text-cream">
              {new Date(sermon.sermonDate).toLocaleDateString()}
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-3">
        <a
          href={sermon.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center rounded bg-gold px-4 font-sans text-label font-medium text-ink transition-colors duration-fast hover:bg-gold-soft active:bg-gold-deep focus:outline-none focus-visible:shadow-glow-gold"
        >
          Open source ↗
        </a>
        {/* T50 will replace this with an inline Watch Together flow.
            Until then, the link above is the path. */}
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled
          title="Watch Together — coming with T50"
        >
          Watch with the group (coming soon)
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="md"
          onClick={() => void handleDelete()}
        >
          Delete
        </Button>
      </div>
    </main>
  );
}
