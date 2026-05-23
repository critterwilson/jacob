"use client";

import { useState } from "react";

import { WellbeingFlagDialog } from "@/components/moderation/WellbeingFlagDialog";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

type Props = {
  subjectUid: string;
  subjectName?: string;
  messageId?: string;
  groupId?: string;
  /** When provided, renders a bare button with this className instead of the
   *  design-system Button — escape hatch for dense contexts like message chips. */
  className?: string;
  label?: string;
};

/**
 * "Flag concern" trigger + WellbeingFlagDialog.
 * Renders nothing when the viewer is not signed in or is viewing their own profile.
 */
export function WellbeingFlagButton({
  subjectUid,
  subjectName,
  messageId,
  groupId,
  className,
  label = "Flag concern",
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user || user.uid === subjectUid) return null;

  const trigger = className ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`Concerned about ${subjectName ?? "this member"}`}
      className={className}
      data-testid="wellbeing-flag-button"
    >
      {label}
    </button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setOpen(true)}
      aria-label={`Concerned about ${subjectName ?? "this member"}`}
      data-testid="wellbeing-flag-button"
    >
      {label}
    </Button>
  );

  return (
    <>
      {trigger}
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
