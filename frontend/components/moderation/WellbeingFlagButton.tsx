"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { WellbeingFlagDialog } from "@/components/moderation/WellbeingFlagDialog";

type Props = {
  subjectUid: string;
  subjectName?: string;
  messageId?: string;
  groupId?: string;
  className?: string;
  label?: string;
};

/**
 * "Concerned about this member" trigger + WellbeingFlagDialog.
 * Renders nothing when the viewer is not signed in or is viewing their own profile.
 */
export function WellbeingFlagButton({
  subjectUid,
  subjectName,
  messageId,
  groupId,
  className,
  label = "Concerned about this member",
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user || user.uid === subjectUid) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Concerned about ${subjectName ?? "this member"}`}
        className={className}
        data-testid="wellbeing-flag-button"
      >
        {label}
      </button>
      <WellbeingFlagDialog
        open={open}
        onClose={() => setOpen(false)}
        subjectUid={subjectUid}
        subjectName={subjectName}
        messageId={messageId}
        groupId={groupId}
      />
    </>
  );
}
