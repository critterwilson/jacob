// Google Form and entry IDs are configured via environment variables.
// See docs/moderation-runbook.md for how to find entry IDs.
// Set NEXT_PUBLIC_REPORT_FORM_ID and NEXT_PUBLIC_REPORT_ENTRY_* in your
// environment. When unset the Report link is hidden/disabled in the UI.

export type ContentType = "message" | "profile" | "group" | "other";

export interface ReportParams {
  contentType: ContentType;
  contentId?: string;
  groupId?: string;
  reporterUid?: string;
}

function getEntry() {
  return {
    contentType: process.env.NEXT_PUBLIC_REPORT_ENTRY_CONTENT_TYPE ?? "entry.000000001",
    contentId: process.env.NEXT_PUBLIC_REPORT_ENTRY_CONTENT_ID ?? "entry.000000002",
    groupId: process.env.NEXT_PUBLIC_REPORT_ENTRY_GROUP_ID ?? "entry.000000003",
    reporterUid: process.env.NEXT_PUBLIC_REPORT_ENTRY_REPORTER_UID ?? "entry.000000004",
    timestamp: process.env.NEXT_PUBLIC_REPORT_ENTRY_TIMESTAMP ?? "entry.000000005",
  } as const;
}

// Stable export for callers that just need the entry key names.
export const ENTRY = getEntry();

/** True when the report form is fully configured. */
export function isReportFormConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_REPORT_FORM_ID);
}

/**
 * Returns a pre-filled Google Form URL, or `null` when the form is not
 * configured (NEXT_PUBLIC_REPORT_FORM_ID unset). Callers should hide or
 * disable the Report link when this returns null.
 */
export function buildReportUrl(params: ReportParams): string | null {
  const formId = process.env.NEXT_PUBLIC_REPORT_FORM_ID;
  if (!formId) return null;

  const formBase = `https://docs.google.com/forms/d/e/${formId}/viewform`;
  const entry = getEntry();
  const { contentType, contentId, groupId, reporterUid } = params;
  const qs = new URLSearchParams();
  qs.set(entry.contentType, contentType);
  if (contentId) qs.set(entry.contentId, contentId);
  if (groupId) qs.set(entry.groupId, groupId);
  if (reporterUid) qs.set(entry.reporterUid, reporterUid);
  qs.set(entry.timestamp, new Date().toISOString());
  return `${formBase}?${qs.toString()}&usp=pp_url`;
}
