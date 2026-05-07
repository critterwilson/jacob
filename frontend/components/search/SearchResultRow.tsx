"use client";

import Link from "next/link";

import type { SearchHit } from "@/lib/hooks/useSearch";
import { sanitiseSnippet } from "@/lib/search-snippet";

type Props = {
  hit: SearchHit;
  onNavigate?: () => void;
};

function hitHref(hit: SearchHit): string {
  // hit.messageRef is "groups/{gid}/messages/{mid}"; we link to the chat
  // page anchored to the message id.
  const parts = hit.messageRef.split("/");
  const gid = parts[1] ?? "";
  const mid = parts[3] ?? "";
  if (!gid || !mid) return "#";
  return `/groups/${encodeURIComponent(gid)}/chat#m-${encodeURIComponent(mid)}`;
}

export function SearchResultRow({ hit, onNavigate }: Props) {
  const safeSnippet = sanitiseSnippet(hit.body ?? "");
  const date = new Date(hit.createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Link
      href={hitHref(hit)}
      onClick={onNavigate}
      className="flex flex-col gap-1 rounded-md px-3 py-2 text-sm hover:bg-ink-overlay"
      data-testid="search-result-row"
    >
      <div className="flex items-baseline justify-between gap-2 text-xs text-cream-muted">
        <span className="truncate">
          {hit.authorDisplayName ?? hit.authorUid}
        </span>
        <time>{date}</time>
      </div>
      <p
        className="text-sm text-cream"
        // SAFE: sanitiseSnippet escapes everything and re-allows ONLY <mark>.
        // See frontend/lib/search-snippet.ts.
        dangerouslySetInnerHTML={{ __html: safeSnippet }}
      />
    </Link>
  );
}
