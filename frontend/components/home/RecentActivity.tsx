"use client";

import Link from "next/link";
import type { RecentMessage } from "@/lib/hooks/useRecentMessages";

type Props = {
  messages: RecentMessage[];
  loading: boolean;
};

export function RecentActivity({ messages, loading }: Props) {
  if (loading) {
    return <p className="text-sm text-gray-500">Loading recent activity…</p>;
  }

  if (messages.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No recent messages yet. Start a conversation in one of your groups!
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
      {messages.map((msg) => (
        <li key={`${msg.gid}-${msg.id}`}>
          <Link
            href={`/groups/${msg.gid}/chat`}
            className="flex flex-col gap-0.5 px-4 py-3 hover:bg-gray-50"
          >
            <span className="text-xs font-medium text-blue-600">{msg.groupName}</span>
            <p className="line-clamp-2 text-sm text-gray-800">
              {msg.mediaRefs?.length > 0 && !msg.body ? "📷 Photo" : (msg.body || "—")}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
