"use client";

import { useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

export type OrgGroupSlice = {
  gid: string;
  name: string;
  totalMessages: number;
  eventAttended: number;
  activeMembers: number;
};

export type EventAttendancePoint = {
  eventId: string;
  title: string;
  startsAt: string;
  rsvpGoing: number;
  attended: number;
};

export type SentimentPoint = {
  day: string;
  avgSeverity: number;
  count: number;
};

export type OrgAnalytics = {
  orgId: string;
  range: "7d" | "30d";
  groupCount: number;
  activeMembers: number;
  totalMessages: number;
  eventAttendance: EventAttendancePoint[];
  sentimentTrend: SentimentPoint[];
  groups: OrgGroupSlice[];
  generatedAt: string;
};

export function useOrgAnalytics(
  orgId: string | null | undefined,
  range: "7d" | "30d" = "30d",
): { data: OrgAnalytics | null; loading: boolean; error: ApiError | null } {
  const [data, setData] = useState<OrgAnalytics | null>(null);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!orgId) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<OrgAnalytics>(
      `/api/orgs/${encodeURIComponent(orgId)}/analytics?range=${range}`,
      { signal: ctrl.signal },
    )
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setError(err instanceof ApiError ? err : null);
        setData(null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [orgId, range]);

  return { data, loading, error };
}
