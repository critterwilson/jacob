"use client";

import { useCallback, useState } from "react";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export type ReportReason =
  | "harassment"
  | "sexual"
  | "violence"
  | "self-harm"
  | "spam"
  | "other";

export type ReportResourceType = "message" | "profile" | "group";

export type SubmitReportArgs = {
  resourceType: ReportResourceType;
  resourceId: string;
  groupId?: string;
  reason: ReportReason;
  context: string;
};

export type SubmitReportResult = {
  reportId: string;
  dedup: boolean;
  severity: number;
};

export type ReportError = {
  code: string;
  message: string;
};

/**
 * `useReport` posts a structured report to `/api/reports`.
 *
 * Returns a submit function plus loading/error state. The hook does not
 * throw — callers should inspect `error` after awaiting `submit`.
 */
export function useReport() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReportError | null>(null);

  const submit = useCallback(
    async (args: SubmitReportArgs): Promise<SubmitReportResult | null> => {
      setError(null);
      if (!user) {
        setError({ code: "unauthenticated", message: "Sign in to report" });
        return null;
      }
      setSubmitting(true);
      try {
        return await apiPost<SubmitReportResult>("/api/reports", args);
      } catch (e) {
        if (e instanceof ApiError) {
          setError({
            code: e.code,
            message: e.message || `HTTP ${e.status}`,
          });
        } else {
          setError({
            code: "network_error",
            message: e instanceof Error ? e.message : "Network error",
          });
        }
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [user],
  );

  return { submit, submitting, error };
}
