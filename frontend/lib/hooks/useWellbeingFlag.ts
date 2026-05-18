"use client";

import { useCallback, useState } from "react";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export type SubmitWellbeingFlagArgs = {
  subjectUid: string;
  note: string;
  messageId?: string;
  groupId?: string;
};

export type SubmitWellbeingFlagResult = {
  flagId: string;
  dedup: boolean;
};

export function useWellbeingFlag() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const submit = useCallback(
    async (args: SubmitWellbeingFlagArgs): Promise<SubmitWellbeingFlagResult | null> => {
      setError(null);
      if (!user) {
        setError({ code: "unauthenticated", message: "Sign in to continue" });
        return null;
      }
      setSubmitting(true);
      try {
        return await apiPost<SubmitWellbeingFlagResult>("/api/wellbeing/flags", args);
      } catch (e) {
        if (e instanceof ApiError) {
          setError({ code: e.code, message: e.message || `HTTP ${e.status}` });
        } else {
          setError({ code: "network_error", message: e instanceof Error ? e.message : "Network error" });
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
