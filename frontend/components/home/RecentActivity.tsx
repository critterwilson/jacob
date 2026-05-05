"use client";

import Link from "next/link";

import type { RecentMessage } from "@/lib/hooks/useRecentMessages";

type Props = {
  messages: RecentMessage[];
  loading: boolean;
};

export function RecentActivity({ messages, loading }: Props) {
  if (loading) {
    return (
      <p className="text-body-sm text-cream-muted">Loading recent activity…</p>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="text-body-sm text-cream-muted">
        No recent messages yet. Start a conversation in one of your groups!
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
      {messages.map((msg) => (
        <li key={`${msg.gid}-${msg.id}`}>
          <Link
            href={`/groups/${msg.gid}/chat`}
            className="flex flex-col gap-1 px-4 py-3 transition-colors duration-fast hover:bg-ink-overlay focus:outline-none focus-visible:bg-ink-overlay focus-visible:shadow-glow-gold"
          >
            <span className="text-eyebrow uppercase tracking-wider text-gold-soft">
              {msg.groupName}
            </span>
            <p className="line-clamp-2 text-body-sm text-cream">
              {msg.mediaRefs?.length > 0 && !msg.body
                ? "📷 Photo"
                : msg.body || "—"}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
