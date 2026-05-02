"use client";

import { useCallback, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
        const token = await user.getIdToken();
        const res = await fetch(`${API}/api/reports`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(args),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: ReportError }
            | null;
          const msg = body?.error?.message ?? `HTTP ${res.status}`;
          const code = body?.error?.code ?? "report_failed";
          setError({ code, message: msg });
          return null;
        }
        return (await res.json()) as SubmitReportResult;
      } catch (e) {
        setError({
          code: "network_error",
          message: e instanceof Error ? e.message : "Network error",
        });
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [user],
  );

  return { submit, submitting, error };
}
