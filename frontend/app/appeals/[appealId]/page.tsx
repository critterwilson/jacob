"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Appeal = {
  appealId: string;
  subject: { type: string; ref: string };
  appellantUid: string;
  submittedAt: string | null;
  body: string;
  decision: "pending" | "upheld" | "reversed";
  decidedAt: string | null;
  reasoning: string | null;
};

export default function AppealDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ appealId: string }>();
  const appealId = params.appealId;
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API}/api/appeals/${appealId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAppeal(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [user, appealId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/home");
      return;
    }
    load();
  }, [user, authLoading, router, load]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    );
  }
  if (error)
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  if (!appeal) return null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Your appeal</h1>
        <p className="mt-1 text-xs text-gray-500">
          Submitted{" "}
          {appeal.submittedAt
            ? new Date(appeal.submittedAt).toLocaleString()
            : "—"}
        </p>
      </header>

      <section className="rounded border border-gray-200 bg-white p-4 text-sm">
        <p>
          <strong>Status:</strong>{" "}
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              appeal.decision === "pending"
                ? "bg-amber-100 text-amber-800"
                : appeal.decision === "reversed"
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-800"
            }`}
          >
            {appeal.decision}
          </span>
        </p>
        {appeal.decidedAt && (
          <p className="mt-2">
            <strong>Decided:</strong>{" "}
            {new Date(appeal.decidedAt).toLocaleString()}
          </p>
        )}
        {appeal.reasoning && (
          <div className="mt-3">
            <strong>Reasoning from the reviewing admin:</strong>
            <p className="mt-1 whitespace-pre-wrap text-gray-800">
              {appeal.reasoning}
            </p>
          </div>
        )}
      </section>

      <section className="rounded border border-gray-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-medium">Your statement</h2>
        <p className="whitespace-pre-wrap text-gray-800">{appeal.body}</p>
      </section>

      {appeal.decision === "pending" && (
        <p className="text-xs text-gray-600">
          A different admin will review your appeal within 7 days.
        </p>
      )}
    </main>
  );
}
