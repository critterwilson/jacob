"use client";

import { useAuth } from "@/lib/auth-context";
import { useMutes } from "@/lib/hooks/useMutes";

type Props = {
  otherUid: string;
  className?: string;
};

/**
 * One-click mute / unmute toggle. Hidden when `otherUid` is the current
 * user (self-mute is a no-op).
 */
export function MuteButton({ otherUid, className }: Props) {
  const { user } = useAuth();
  const { isMuted, mute, unmute } = useMutes();

  if (!user || otherUid === user.uid) return null;

  const muted = isMuted(otherUid);

  return (
    <button
      type="button"
      onClick={() => void (muted ? unmute(otherUid) : mute(otherUid))}
      aria-pressed={muted}
      aria-label={muted ? "Unmute user" : "Mute user"}
      className={className}
    >
      {muted ? "Unmute" : "Mute"}
    </button>
  );
}
