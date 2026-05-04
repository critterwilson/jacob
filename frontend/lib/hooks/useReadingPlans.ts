"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";

export type ReadingPlanDay = {
  dayNumber: number;
  scriptureRef: string;
  prompt: string;
};

export type ReadingPlan = {
  slug: string;
  title: string;
  description: string;
  days: ReadingPlanDay[];
  duration: number;
  audience: "christian" | "general";
  publishedAt: string | null;
};

export type ReadingPlanSummary = {
  slug: string;
  title: string;
  description: string;
  duration: number;
  audience: "christian" | "general";
  publishedAt: string | null;
};

export type PlanProgress = {
  planSlug: string;
  startedAt: string | null;
  completedDays: number[];
  streak: number;
  lastCompletedAt: string | null;
};

export function useReadingPlans(): {
  plans: ReadingPlanSummary[];
  loading: boolean;
} {
  const [plans, setPlans] = useState<ReadingPlanSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    apiGet<{ plans: ReadingPlanSummary[] }>("/api/reading-plans", {
      signal: ctrl.signal,
    })
      .then((res) => {
        setPlans(res.plans);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setPlans([]);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  return { plans, loading };
}

export function useReadingPlan(slug: string | null): {
  plan: ReadingPlan | null;
  loading: boolean;
} {
  const [plan, setPlan] = useState<ReadingPlan | null>(null);
  const [loading, setLoading] = useState(Boolean(slug));

  useEffect(() => {
    if (!slug) {
      setPlan(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    apiGet<ReadingPlan>(`/api/reading-plans/${encodeURIComponent(slug)}`, {
      signal: ctrl.signal,
    })
      .then((res) => {
        setPlan(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setPlan(null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [slug]);

  return { plan, loading };
}

export function usePlanProgress(slug: string | null): {
  progress: PlanProgress | null;
  loading: boolean;
  reload: () => void;
  markComplete: (dayNumber: number) => Promise<PlanProgress | null>;
} {
  const [progress, setProgress] = useState<PlanProgress | null>(null);
  const [loading, setLoading] = useState(Boolean(slug));
  const [token, setToken] = useState(0);

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    if (!slug) {
      setProgress(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    apiGet<PlanProgress>(
      `/api/reading-plans/${encodeURIComponent(slug)}/progress`,
      { signal: ctrl.signal },
    )
      .then((res) => {
        setProgress(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "aborted") return;
        setProgress(null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [slug, token]);

  const markComplete = useCallback(
    async (dayNumber: number): Promise<PlanProgress | null> => {
      if (!slug) return null;
      try {
        const res = await apiPost<PlanProgress>(
          `/api/reading-plans/${encodeURIComponent(slug)}/progress/mark`,
          { dayNumber },
        );
        // Mark-complete returns the new state minus startedAt; merge with
        // existing progress if any.
        setProgress((prev) => ({
          planSlug: slug,
          startedAt: prev?.startedAt ?? null,
          completedDays: res.completedDays,
          streak: res.streak,
          lastCompletedAt: res.lastCompletedAt,
        }));
        return res;
      } catch (err) {
        if (err instanceof ApiError) {
          console.warn("plan_mark_failed", err.code, err.status);
        }
        return null;
      }
    },
    [slug],
  );

  return { progress, loading, reload, markComplete };
}
