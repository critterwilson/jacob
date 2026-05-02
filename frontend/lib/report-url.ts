// Google Form and entry IDs are set up out-of-band (see docs/moderation-runbook.md).
// Replace FORM_ID and ENTRY_* with the real values once the form is created.
const FORM_ID = "YOUR_FORM_ID";
const FORM_BASE = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;

export const ENTRY = {
  contentType: "entry.000000001",
  contentId: "entry.000000002",
  groupId: "entry.000000003",
  reporterUid: "entry.000000004",
  timestamp: "entry.000000005",
} as const;

export type ContentType = "message" | "profile" | "group" | "other";

export interface ReportParams {
  contentType: ContentType;
  contentId?: string;
  groupId?: string;
  reporterUid?: string;
}

export function buildReportUrl(params: ReportParams): string {
  const { contentType, contentId, groupId, reporterUid } = params;
  const qs = new URLSearchParams();
  qs.set(ENTRY.contentType, contentType);
  if (contentId) qs.set(ENTRY.contentId, contentId);
  if (groupId) qs.set(ENTRY.groupId, groupId);
  if (reporterUid) qs.set(ENTRY.reporterUid, reporterUid);
  qs.set(ENTRY.timestamp, new Date().toISOString());
  return `${FORM_BASE}?${qs.toString()}&usp=pp_url`;
}
