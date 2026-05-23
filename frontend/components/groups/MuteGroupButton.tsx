"use client";

import { Button } from "@/components/ui";
import { useMutedGroups } from "@/lib/hooks/useMutedGroups";

type Props = {
  groupId: string;
  className?: string;
};

/**
 * One-click "Mute notifications" / "Unmute" toggle for a group. Silences
 * the generic `group_message` push fan-out for the current user only;
 * @mentions and replies still come through.
 *
 * Per design-system §9: a tertiary in-page action inside a header
 * cluster → `Button variant="secondary" size="sm"`. Not full-width.
 */
export function MuteGroupButton({ groupId, className }: Props) {
  const { isGroupMuted, muteGroup, unmuteGroup, loading } = useMutedGroups();
  const muted = isGroupMuted(groupId);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={loading}
      onClick={() =>
        void (muted ? unmuteGroup(groupId) : muteGroup(groupId))
      }
      aria-pressed={muted}
      aria-label={
        muted ? "Unmute notifications for this group" : "Mute notifications for this group"
      }
      className={className}
    >
      {muted ? "Unmute" : "Mute"}
    </Button>
  );
}
