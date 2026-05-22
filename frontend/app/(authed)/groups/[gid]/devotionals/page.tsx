"use client";

import { useParams } from "next/navigation";

import { OpenBook } from "@/components/motifs/OpenBook";
import {
  ButtonLink,
  Card,
  Eyebrow,
  FloatingActionBar,
  Heading,
  Link,
} from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroupDevotionals } from "@/lib/hooks/useDevotionals";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";

export default function GroupDevotionalsPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const { user } = useAuth();
  const { isLeader } = useGroupMembership(user?.uid, gid);
  const { devotionals, loading } = useGroupDevotionals(gid);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
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
              Devotionals
            </Heading>
            <p className="text-body-sm text-cream-muted">
              Reflections written for this group.
            </p>
          </div>
        </div>
        {/* Desktop CTA; mobile uses the FloatingActionBar below. */}
        {isLeader && (
          <ButtonLink
            href={`/groups/${gid}/devotionals/new`}
            variant="primary"
            className="hidden md:inline-flex"
          >
            Write devotional
          </ButtonLink>
        )}
      </header>

      {loading ? (
        <p className="text-body-sm text-cream-muted">Loading…</p>
      ) : devotionals.length === 0 ? (
        <p className="text-body-sm text-cream-muted">
          No devotionals yet.
          {isLeader && " Use “Write devotional” to publish one."}
        </p>
      ) : (
        <ul className="space-y-3">
          {devotionals.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/devotionals/${d.slug}`}
                variant="muted"
                className="block rounded-lg no-underline hover:no-underline focus:outline-none focus-visible:shadow-glow-gold"
              >
                <Card
                  surface="raised"
                  interactive
                  padding="md"
                  className="space-y-2"
                >
                  <h2 className="font-display text-display-sm text-cream">
                    {d.title}
                  </h2>
                  <p className="text-caption text-gold-soft">{d.scriptureRef}</p>
                  <p className="text-body text-cream-muted">
                    {d.body
                      .replace(/[*_#`]/g, "")
                      .split("\n")[0]
                      .slice(0, 160)}
                    …
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {isLeader && (
        <FloatingActionBar
          label="Write devotional"
          href={`/groups/${gid}/devotionals/new`}
        />
      )}
    </main>
  );
}
