"use client";

import Link from "next/link";
import type { DiscoverGroup } from "@/lib/hooks/useDiscoverGroups";
import { JoinRequestButton } from "./JoinRequestButton";

type Props = { group: DiscoverGroup };

export function GroupCard({ group }: Props) {
  return (
    <article className="rounded border border-gray-200 p-4">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/discover/${group.gid}`}
            className="text-base font-semibold text-gray-900 hover:underline"
          >
            {group.name}
          </Link>
          <p className="text-xs text-gray-500">
            {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
            {" · "}
            {group.audience}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
          {group.joinMode === "request" ? "Request to join" : "Open"}
        </span>
      </div>
      {group.description && (
        <p className="mb-3 text-sm text-gray-600 line-clamp-2">{group.description}</p>
      )}
      <JoinRequestButton gid={group.gid} joinMode={group.joinMode} />
    </article>
  );
}
