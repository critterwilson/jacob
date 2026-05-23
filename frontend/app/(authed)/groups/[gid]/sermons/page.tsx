"use client";

import { useParams } from "next/navigation";
import NextLink from "next/link";
import { useMemo, useState } from "react";

import { OpenBook } from "@/components/motifs/OpenBook";
import {
  Banner,
  ButtonLink,
  Card,
  Eyebrow,
  FloatingActionBar,
  Heading,
  Link,
  Select,
} from "@/components/ui";
import {
  type Sermon,
  useGroupSermons,
} from "@/lib/hooks/useGroupSermons";
import { useAuth } from "@/lib/auth-context";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { safeImageSrc } from "@/lib/safeUrl";

export default function SermonsListPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const { sermons, preachers, loading, error } = useGroupSermons(gid);
  const { user } = useAuth();
  const { isLeader } = useGroupMembership(user?.uid, gid);

  const [preacherFilter, setPreacherFilter] = useState<string>("");

  const filtered = useMemo(() => {
    if (!preacherFilter) return sermons;
    return sermons.filter((s) => s.preacher === preacherFilter);
  }, [sermons, preacherFilter]);

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
        {/* Desktop CTA; mobile uses the FloatingActionBar below. */}
        {isLeader && (
          <ButtonLink
            href={`/groups/${gid}/sermons/new`}
            variant="primary"
            className="hidden md:inline-flex"
          >
            Add sermon
          </ButtonLink>
        )}
      </header>

      <div className="flex items-center gap-3">
        <Select
          label="Filter by preacher"
          value={preacherFilter}
          onChange={(e) => setPreacherFilter(e.target.value)}
          className="w-56"
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
        <p className="text-body-sm text-cream-muted">
          {isLeader
            ? "No sermons yet. Use Add sermon above to add the first one."
            : "No sermons yet — check back soon."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((sermon) => (
            <SermonRow key={sermon.sermonId} gid={gid} sermon={sermon} />
          ))}
        </ul>
      )}

      {isLeader && (
        <FloatingActionBar
          label="Add sermon"
          href={`/groups/${gid}/sermons/new`}
        />
      )}
    </main>
  );
}

function SermonRow({ gid, sermon }: { gid: string; sermon: Sermon }) {
  const safeThumbnail = safeImageSrc(sermon.thumbnail);
  return (
    <li>
      <NextLink
        href={`/groups/${gid}/sermons/${sermon.sermonId}`}
        className="block rounded-lg focus:outline-none focus-visible:shadow-glow-gold"
      >
        <Card surface="raised" interactive padding="sm" className="space-y-2">
          {safeThumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={safeThumbnail}
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
