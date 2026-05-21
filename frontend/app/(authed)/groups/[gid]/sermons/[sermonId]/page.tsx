"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { SermonForm } from "@/components/groups/SermonForm";
import type { SermonFormValues } from "@/components/groups/SermonForm";
import { Button, Eyebrow, Heading, Link } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useGroupSermons } from "@/lib/hooks/useGroupSermons";
import { safeHttpUrl, safeImageSrc } from "@/lib/safeUrl";

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
  const { sermons, loading, deleteSermon, patchSermon } = useGroupSermons(gid);
  const sermon = useMemo(
    () => sermons.find((s) => s.sermonId === sermonId) ?? null,
    [sermons, sermonId],
  );
  const { user } = useAuth();
  const { isLeader } = useGroupMembership(user?.uid, gid);

  const [editing, setEditing] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }
  if (!sermon) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
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
    if (!confirm(`Delete "${sermon.title}"?`)) return;
    const ok = await deleteSermon(sermonId);
    if (ok) window.location.assign(`/groups/${gid}/sermons`);
  };

  const handleEdit = async (
    values: SermonFormValues,
  ): Promise<string | null> => {
    const res = await patchSermon(sermonId, {
      title: values.title || undefined,
      preacher: values.preacher || undefined,
      scripture: values.scripture || undefined,
      sermonDate: values.sermonDate || undefined,
    });
    if (!res) return "Failed to save changes.";
    setEditing(false);
    return null;
  };

  const safeSourceUrl = safeHttpUrl(sermon.sourceUrl);
  const safeThumbnail = safeImageSrc(sermon.thumbnail);

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <Link
        href={`/groups/${gid}/sermons`}
        variant="muted"
        className="text-caption"
      >
        ← Sermon archive
      </Link>

      {!editing ? (
        <>
          {safeThumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={safeThumbnail}
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
            {safeSourceUrl && (
              <a
                href={safeSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center rounded bg-gold px-4 font-sans text-label font-medium text-ink transition-colors duration-fast hover:bg-gold-soft active:bg-gold-deep focus:outline-none focus-visible:shadow-glow-gold"
              >
                Open source ↗
              </a>
            )}
            {/* T50 (Watch Together) is parked as of 2026-05-17 — video features
                deferred by ministry owner. Button stays disabled. Re-enable when
                T50 is revived (see docs/follow-ups/phase-3-parked.md § T50). */}
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled
              title="Watch Together — not available right now"
            >
              Watch with the group (not available)
            </Button>
            {isLeader && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="md"
                  onClick={() => void handleDelete()}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <section className="space-y-4">
          <Heading level={2} size="sm">
            Edit sermon
          </Heading>
          <SermonForm
            mode="edit"
            defaultValues={{
              title: sermon.title,
              preacher: sermon.preacher ?? "",
              scripture: sermon.scripture ?? "",
              sermonDate: sermon.sermonDate ?? "",
            }}
            submitLabel="Save changes"
            onSubmit={handleEdit}
            onCancel={() => setEditing(false)}
          />
        </section>
      )}
    </main>
  );
}
