"use client";

import { useAuth } from "@/lib/auth-context";
import { useBlocks } from "@/lib/hooks/useBlocks";

type Props = {
  otherUid: string;
  className?: string;
};

/**
 * One-click block / unblock toggle. Hidden when `otherUid` is the
 * current user. Block is stronger than mute — confirmation should
 * happen at the call site (the profile preview popover wraps this in a
 * confirm dialog).
 */
export function BlockButton({ otherUid, className }: Props) {
  const { user } = useAuth();
  const { isBlocked, block, unblock } = useBlocks();

  if (!user || otherUid === user.uid) return null;

  const blocked = isBlocked(otherUid);

  return (
    <button
      type="button"
      onClick={() => void (blocked ? unblock(otherUid) : block(otherUid))}
      aria-pressed={blocked}
      aria-label={blocked ? "Unblock user" : "Block user"}
      className={className}
    >
      {blocked ? "Unblock" : "Block"}
    </button>
  );
}
