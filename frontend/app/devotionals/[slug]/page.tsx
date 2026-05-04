"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

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
          className="my-3 border-l-4 border-blue-300 bg-blue-50 px-3 py-2 italic text-gray-700"
        >
          {renderInline(block.slice(2))}
        </blockquote>
      );
    }
    return (
      <p key={i} className="my-3 leading-relaxed">
        {renderInline(block)}
      </p>
    );
  });
}

function renderInline(text: string): JSX.Element[] {
  // Pass: ** → bold, * → italic, ` → mono. Keep it cheap; T53 is real.
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
        <code key={key++} className="rounded bg-gray-100 px-1 text-xs">
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
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }
  if (!devotional) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Link href="/devotionals" className="text-xs text-gray-500">
          ← Devotionals
        </Link>
        <p className="mt-4 text-sm text-gray-700">Devotional not found.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href="/devotionals" className="text-xs text-gray-500">
        ← Devotionals
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">{devotional.title}</h1>
      <p className="mt-1 text-sm text-blue-700">{devotional.scriptureRef}</p>
      <article className="prose prose-sm mt-6 max-w-none text-gray-800">
        {renderMarkdown(devotional.body)}
      </article>
      {devotional.audioUrl && (
        <p className="mt-6 text-sm">
          <a
            href={devotional.audioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            Listen (opens in a new tab)
          </a>
        </p>
      )}
      <footer className="mt-8 text-xs text-gray-500">
        {devotional.sourceAttribution}
      </footer>
    </main>
  );
}
