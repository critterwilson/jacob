"use client";

// T53 — message-body renderer (markdown subset + unfurl cards).
//
// `body` is the raw message text. `unfurls` is the persisted unfurl
// list when the message-create trigger has populated it; until that
// trigger lands (T53 follow-up), MessageBody also accepts
// `clientUnfurls` from the live `useUnfurl` hook so previews show on
// the sender's side without a doc round-trip.

import { useMemo } from "react";

import { UnfurlCard } from "@/components/chat/UnfurlCard";
import { renderMarkdownToHtml } from "@/lib/markdown";

export type Unfurl = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

export function MessageBody({
  body,
  unfurls,
  clientUnfurls,
}: {
  body: string;
  unfurls?: Unfurl[];
  clientUnfurls?: Unfurl[];
}) {
  const html = useMemo(() => renderMarkdownToHtml(body), [body]);
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: Unfurl[] = [];
    for (const list of [unfurls, clientUnfurls]) {
      if (!list) continue;
      for (const u of list) {
        if (seen.has(u.url)) continue;
        seen.add(u.url);
        out.push(u);
        if (out.length >= 3) break;
      }
      if (out.length >= 3) break;
    }
    return out;
  }, [unfurls, clientUnfurls]);

  return (
    <div className="space-y-2">
      <div
        className="prose prose-sm max-w-none break-words leading-relaxed text-gray-800 [&_a]:text-blue-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-2 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:text-xs"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {merged.length > 0 && (
        <div className="space-y-2">
          {merged.map((u) => (
            <UnfurlCard key={u.url} unfurl={u} />
          ))}
        </div>
      )}
    </div>
  );
}
