"use client";

// T48 — "Alice is typing..." indicator. Up to 2 named users; falls
// back to "and N others" beyond that. ARIA-live=polite so screen
// readers don't interrupt.

import { useTyping } from "@/lib/hooks/useTyping";

export function TypingIndicator({
  gid,
  presenceEnabled,
  resolveName,
}: {
  gid: string;
  presenceEnabled: boolean;
  resolveName?: (uid: string) => string;
}) {
  const { others } = useTyping(gid, presenceEnabled);
  if (!presenceEnabled || others.length === 0) return null;
  const names = others.map((o) => (resolveName ? resolveName(o.uid) : "Someone"));
  let label: string;
  if (names.length === 1) {
    label = `${names[0]} is typing…`;
  } else if (names.length === 2) {
    label = `${names[0]} and ${names[1]} are typing…`;
  } else {
    label = `${names[0]}, ${names[1]} and ${names.length - 2} others are typing…`;
  }
  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      className="px-2 py-1 text-xs italic text-gray-500"
    >
      {label}
    </p>
  );
}
