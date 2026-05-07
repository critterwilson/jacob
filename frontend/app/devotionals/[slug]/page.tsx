"use client";

import { useParams } from "next/navigation";

import { Eyebrow, Heading, Link } from "@/components/ui";
import { useDevotional } from "@/lib/hooks/useDevotionals";

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink text-body-sm text-cream-muted">
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

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <Link href="/devotionals" variant="muted" className="text-caption">
        ← Devotionals
      </Link>

      <header className="space-y-2">
        <Eyebrow>Devotional</Eyebrow>
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

      <footer className="border-t border-line pt-4 text-caption text-cream-muted">
        {devotional.sourceAttribution}
      </footer>
    </main>
  );
}
