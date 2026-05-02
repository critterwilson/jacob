"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import type {
  ReportResourceType,
} from "@/lib/hooks/useReport";

type Props = {
  resourceType: ReportResourceType;
  resourceId: string;
  groupId?: string;
  className?: string;
};

/**
 * Trigger button + ReportDialog in one component. Hidden for signed-out
 * users (they can sign in then report). The dialog itself enforces the
 * structured shape required by `POST /api/reports`.
 */
export function ReportButton({
  resourceType,
  resourceId,
  groupId,
  className,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Report this ${resourceType}`}
        className={className}
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      </button>
      <ReportDialog
        open={open}
        onClose={() => setOpen(false)}
        resourceType={resourceType}
        resourceId={resourceId}
        groupId={groupId}
      />
    </>
  );
}
