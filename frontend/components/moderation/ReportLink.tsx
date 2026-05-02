"use client";

import { useAuth } from "@/lib/auth-context";
import { buildReportUrl, type ContentType } from "@/lib/report-url";

type Props = {
  contentType: ContentType;
  contentId?: string;
  groupId?: string;
  className?: string;
};

export function ReportLink({ contentType, contentId, groupId, className }: Props) {
  const { user } = useAuth();

  const href = buildReportUrl({
    contentType,
    contentId,
    groupId,
    reporterUid: user?.uid ?? undefined,
  });

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Report"
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
    </a>
  );
}
