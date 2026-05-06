import type { Member as FullMember } from "@/lib/hooks/useMembers";

// `mentions.ts` only needs `uid` + `displayName`; accepting a narrower
// shape lets test fixtures stay compact and lets callers pass any list
// that has those two fields (e.g. legacy `useMembers` callers).
export type Member = Pick<FullMember, "uid" | "displayName">;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractMentionedUids(
  body: string,
  members: readonly Member[] | undefined,
): string[] {
  if (!members || members.length === 0) return [];
  // Sort longest name first so "@Alice B" matches before "@Alice".
  const sorted = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  const uids: string[] = [];
  for (const member of sorted) {
    const pattern = new RegExp(
      `@${escapeRegex(member.displayName)}(?:\\s|$)`,
      "i",
    );
    if (pattern.test(body)) {
      uids.push(member.uid);
    }
  }
  return Array.from(new Set(uids));
}

