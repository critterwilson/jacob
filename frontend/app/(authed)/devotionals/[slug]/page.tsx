"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

import { DevotionalForm } from "@/components/devotionals/DevotionalForm";
import type { DevotionalFormValues } from "@/components/devotionals/DevotionalForm";
import { useAuth } from "@/lib/auth-context";
import { Button, Eyebrow, Heading, Link } from "@/components/ui";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";
import {
  useDevotional,
  useDevotionalMutations,
} from "@/lib/hooks/useDevotionals";

// Minimal markdown rendering: bold (**), italic (*), inline code (`),
// blockquote (>), paragraphs. T53 will replace this with the shared
// renderer; until then, the devotional body is treated as text with a
// few escape sequences so the seed content reads cleanly.
function renderMarkdown(body: string): JSX.Element[] {
  const blocks = body.split(/\n\n+/);
  return blocks.map((block, i) => {
    if (block.startsWith("> ")) {
      return (
        <blockquote
          key={i}
          className="my-4 border-l-2 border-gold-soft bg-ink-raised px-4 py-3 font-display text-body-lg italic text-cream"
        >
          {renderInline(block.slice(2))}
        </blockquote>
      );
    }
    return (
      <p key={i} className="my-4 text-body-lg leading-relaxed text-cream">
        {renderInline(block)}
      </p>
    );
  });
}

function renderInline(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  let cursor = 0;
  let key = 0;
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(<span key={key++}>{text.slice(cursor, match.index)}</span>);
    }
    const tok = match[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-ink-overlay px-1 font-mono text-body-sm text-cream"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    cursor = match.index + tok.length;
  }
  if (cursor < text.length) {
    parts.push(<span key={key++}>{text.slice(cursor)}</span>);
  }
  return parts;
}

export default function DevotionalPage() {
  const params = useParams();
  const slug = String(
    Array.isArray(params?.slug) ? params.slug[0] : (params?.slug ?? ""),
  );
  const { devotional, loading } = useDevotional(slug);
  const claims = useRoleClaims();
  const { user } = useAuth();
  const { patchDevotional, deleteDevotional } = useDevotionalMutations();
  const [editing, setEditing] = useState(false);

  // Mutation gates mirror the backend (`_authorize_devotional_mutation`):
  // platform-wide → ministry_owner (or admin); group-scoped → leader of
  // the named group (or admin). Admins always see edit/delete.
  const isAdmin = claims?.isAdmin === true;
  const isMinistryOwner = claims?.isMinistryOwner === true;
  const groupId = devotional?.groupId ?? null;
  const { isLeader: isLeaderOfDevotionalGroup } = useGroupMembership(
    user?.uid,
    groupId ?? undefined,
  );
  const canMutate = isAdmin
    ? true
    : groupId
      ? isLeaderOfDevotionalGroup
      : isMinistryOwner;

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }
  if (!devotional) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-3">
        <Link href="/devotionals" variant="muted" className="text-caption">
          ← Devotionals
        </Link>
        <p className="text-body-sm text-cream">Devotional not found.</p>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${devotional.title}"?`)) return;
    const ok = await deleteDevotional(slug);
    if (ok) window.location.assign("/devotionals");
  };

  const handleEdit = async (
    values: DevotionalFormValues,
  ): Promise<string | null> => {
    const res = await patchDevotional(slug, {
      title: values.title,
      scriptureRef: values.scriptureRef || undefined,
      body: values.body,
      audioUrl: values.audioUrl || null,
      sourceAttribution: values.sourceAttribution || undefined,
      publishedAt: values.publishedAt || null,
      audience: values.audience,
    });
    if (!res) return "Failed to save changes.";
    setEditing(false);
    // Reload to pick up updated content from the server.
    window.location.reload();
    return null;
  };

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <Link href="/devotionals" variant="muted" className="text-caption">
        ← Devotionals
      </Link>

      {!editing ? (
        <>
          <header className="space-y-2">
            <Eyebrow>
              {devotional.groupName
                ? `Devotional · ${devotional.groupName}`
                : "Devotional"}
            </Eyebrow>
            <Heading level={1} size="lg">
              {devotional.title}
            </Heading>
            <p className="text-body-sm text-gold-soft">
              {devotional.scriptureRef}
            </p>
          </header>

          <article className="max-w-none">
            {renderMarkdown(devotional.body)}
          </article>

          {devotional.audioUrl && (
            <p className="text-body-sm">
              <Link
                href={devotional.audioUrl}
                variant="accent"
                target="_blank"
                rel="noopener noreferrer"
              >
                Listen (opens in a new tab)
              </Link>
            </p>
          )}

          {canMutate && (
            <div className="flex flex-wrap gap-3 border-t border-line pt-4">
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
            </div>
          )}

          <footer className="border-t border-line pt-4 text-caption text-cream-muted">
            {devotional.sourceAttribution}
          </footer>
        </>
      ) : (
        <section className="space-y-4">
          <Heading level={2} size="sm">
            Edit devotional
          </Heading>
          <DevotionalForm
            mode="edit"
            defaultValues={{
              title: devotional.title,
              scriptureRef: devotional.scriptureRef ?? "",
              body: devotional.body,
              audioUrl: devotional.audioUrl ?? "",
              sourceAttribution: devotional.sourceAttribution ?? "",
              publishedAt: devotional.publishedAt
                ? devotional.publishedAt.slice(0, 10)
                : "",
              audience: devotional.audience,
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
