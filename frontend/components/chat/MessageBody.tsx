"use client";

// T53 — message-body renderer (markdown subset + unfurl cards +
// @-mention badges).
//
// `body` is the raw message text. `unfurls` is the persisted unfurl
// list when the message-create trigger has populated it; until that
// trigger lands MessageBody also fetches unfurls on its own from
// `useUnfurl` so previews show on the sender's side without a doc
// round-trip. `clientUnfurls` is preserved as a test-injection seam.
//
// Mention rendering is done in two stages so it composes safely with
// markdown: (1) replace `@DisplayName` runs with a private-use
// Unicode placeholder *before* markdown parsing, so markdown never
// sees the text; (2) splice the sanitized HTML on the placeholder
// boundaries and render the segments + mention badges as React
// children. The badge HTML never goes through `dangerouslySetInnerHTML`,
// so a malicious displayName can't smuggle a script through.

import { Fragment, useMemo } from "react";

import { UnfurlCard } from "@/components/chat/UnfurlCard";
import { useUnfurl } from "@/lib/hooks/useUnfurl";
import { renderMarkdownToHtml } from "@/lib/markdown";

export type Unfurl = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

type MentionMember = {
  uid: string;
  displayName: string;
};

// Private-use Unicode code points (U+E000, U+E001) so the placeholder
// pattern can never collide with anything a user typed.
const PLACEHOLDER_OPEN = "\uE000";
const PLACEHOLDER_CLOSE = "\uE001";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPlaceholder(i: number): string {
  return `${PLACEHOLDER_OPEN}MENTION_${i}${PLACEHOLDER_CLOSE}`;
}

function preprocessMentions(
  body: string,
  mentions: readonly string[],
  members: readonly MentionMember[],
): { processed: string; tokens: { placeholder: string; member: MentionMember }[] } {
  if (mentions.length === 0) return { processed: body, tokens: [] };
  const mentioned = mentions
    .map((uid) => members.find((m) => m.uid === uid))
    .filter((m): m is MentionMember => Boolean(m));
  if (mentioned.length === 0) return { processed: body, tokens: [] };
  // Longest displayName first so "@Alice B" matches before "@Alice".
  const sorted = [...mentioned].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  let processed = body;
  const tokens: { placeholder: string; member: MentionMember }[] = [];
  sorted.forEach((member, i) => {
    const placeholder = buildPlaceholder(i);
    // Match `@DisplayName` only at a word/sentence boundary so we don't
    // split mid-word.
    const pattern = new RegExp(
      `@${escapeRegex(member.displayName)}(?=\\s|$|[^\\w])`,
      "gi",
    );
    if (pattern.test(processed)) {
      processed = processed.replace(pattern, placeholder);
      tokens.push({ placeholder, member });
    }
  });
  return { processed, tokens };
}

export function MessageBody({
  body,
  unfurls,
  clientUnfurls,
  mentions,
  members,
  currentUserUid,
}: {
  body: string;
  unfurls?: Unfurl[];
  /**
   * Test-injected unfurl list. Production callers omit this and let
   * `useUnfurl` fetch from `POST /api/unfurl`.
   */
  clientUnfurls?: Unfurl[];
  mentions?: readonly string[];
  members?: readonly MentionMember[];
  currentUserUid?: string;
}) {
  const { processed, tokens } = useMemo(
    () => preprocessMentions(body, mentions ?? [], members ?? []),
    [body, mentions, members],
  );

  const html = useMemo(() => renderMarkdownToHtml(processed), [processed]);

  // Split sanitized HTML on placeholder boundaries. We render each
  // chunk via `dangerouslySetInnerHTML` and the badges as plain React
  // children — a hostile displayName can't escape JSX text rendering.
  const segments = useMemo(() => {
    if (tokens.length === 0) {
      return [{ kind: "html" as const, value: html }];
    }
    type Segment =
      | { kind: "html"; value: string }
      | { kind: "mention"; member: MentionMember };
    const out: Segment[] = [];
    let remaining = html;
    while (remaining.length > 0) {
      // Find the earliest placeholder occurrence.
      let nextIdx = -1;
      let nextToken: (typeof tokens)[number] | null = null;
      for (const t of tokens) {
        const i = remaining.indexOf(t.placeholder);
        if (i !== -1 && (nextIdx === -1 || i < nextIdx)) {
          nextIdx = i;
          nextToken = t;
        }
      }
      if (nextIdx === -1 || !nextToken) {
        out.push({ kind: "html", value: remaining });
        break;
      }
      if (nextIdx > 0) {
        out.push({ kind: "html", value: remaining.slice(0, nextIdx) });
      }
      out.push({ kind: "mention", member: nextToken.member });
      remaining = remaining.slice(nextIdx + nextToken.placeholder.length);
    }
    return out;
  }, [html, tokens]);

  // `useUnfurl` returns [] when the body has no URLs, so the eager
  // call is cheap. Skip if the caller already supplied a list — this
  // lets tests inject deterministic unfurls without mocking the API.
  const fetched = useUnfurl(clientUnfurls === undefined ? body : "");
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: Unfurl[] = [];
    const liveClient = clientUnfurls ?? fetched;
    for (const list of [unfurls, liveClient]) {
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
  }, [unfurls, clientUnfurls, fetched]);

  return (
    <div className="space-y-2">
      <div className="break-words leading-relaxed text-body text-cream [&_a]:text-gold-soft [&_a]:underline hover:[&_a]:text-gold [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-cream-muted [&_code]:rounded [&_code]:bg-ink-overlay [&_code]:px-1 [&_code]:text-caption [&_code]:text-cream [&_p]:whitespace-pre-wrap [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-cream">
        {segments.map((seg, i) => {
          if (seg.kind === "html") {
            return (
              <span
                key={i}
                dangerouslySetInnerHTML={{ __html: seg.value }}
              />
            );
          }
          const isSelf =
            currentUserUid !== undefined && seg.member.uid === currentUserUid;
          return (
            <Fragment key={i}>
              <span
                className={
                  "inline-block rounded px-1 text-body-sm font-medium " +
                  (isSelf
                    ? "bg-gold/20 text-gold-soft"
                    : "bg-lake/20 text-lake")
                }
              >
                @{seg.member.displayName}
              </span>
            </Fragment>
          );
        })}
      </div>
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
