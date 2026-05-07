"use client";

// T48 — "N online now" indicator. Renders nothing if presence is
// disabled for the group or the count is zero.

import { type PresenceEntry, usePresence } from "@/lib/hooks/usePresence";

export function PresenceBar({
  gid,
  presenceEnabled,
}: {
  gid: string;
  presenceEnabled: boolean;
}) {
  const { online } = usePresence(gid, presenceEnabled);
  if (!presenceEnabled || online.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="off"
      title={online.map((o: PresenceEntry) => o.uid).join(", ")}
      className="text-xs text-sage"
    >
      <span aria-hidden="true">●</span> {online.length} online
    </div>
  );
}
