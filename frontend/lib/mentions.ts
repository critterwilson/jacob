import type { Member } from "@/lib/hooks/useMembers";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractMentionedUids(body: string, members: Member[]): string[] {
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

export type MentionToken = {
  uid: string;
  displayName: string;
  isSelf: boolean;
};

export function renderBodyWithMentions(
  body: string,
  mentionedUids: string[],
  members: Member[],
  currentUserUid?: string,
): Array<string | MentionToken> {
  if (mentionedUids.length === 0) return [body];

  const mentioned = mentionedUids
    .map((uid) => members.find((m) => m.uid === uid))
    .filter((m): m is Member => m !== undefined);

  if (mentioned.length === 0) return [body];

  // Longest name first to avoid partial matches on common prefixes.
  const sorted = [...mentioned].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  const pattern = new RegExp(
    `(@(?:${sorted.map((m) => escapeRegex(m.displayName)).join("|")}))`,
    "gi",
  );

  const parts = body.split(pattern);
  return parts.map((part) => {
    if (part.startsWith("@")) {
      const name = part.slice(1);
      const member = mentioned.find(
        (m) => m.displayName.toLowerCase() === name.toLowerCase(),
      );
      if (member) {
        return {
          uid: member.uid,
          displayName: member.displayName,
          isSelf: member.uid === currentUserUid,
        };
      }
    }
    return part;
  });
}
