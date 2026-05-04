"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Appeal = {
  appealId: string;
  subject: { type: "message" | "ban" | "group_archive"; ref: string };
  appellantUid: string;
  originalActorUid: string | null;
  originalActionAt: string | null;
  submittedAt: string | null;
  body: string;
  decision: "pending" | "upheld" | "reversed";
  decidedBy: string | null;
  decidedAt: string | null;
  reasoning: string | null;
  overdue: boolean;
};

export default function AdminAppealDetailPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ appealId: string }>();
  const appealId = params.appealId;
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<"upheld" | "reversed">("upheld");
  const [reasoning, setReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    load();
  }, [load]);

  const decide = async () => {
    if (!user || !appeal) return;
    if (reasoning.trim().length < 50) {
      alert("Reasoning must be at least 50 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${API}/api/admin/appeals/${appealId}/decide`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ decision, reasoning }),
        },
      );
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error?.message) msg = body.error.message;
        } catch {
          /* fall through */
        }
        throw new Error(msg);
      }
      router.replace("/admin/appeals");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decide failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (error)
    return (
      <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
        {error}
      </div>
    );
  if (!appeal) return <p className="text-sm text-gray-500">Not found.</p>;

  const isPending = appeal.decision === "pending";

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Appeal {appeal.appealId}</h1>
        <p className="mt-1 text-xs text-gray-500">
          Submitted{" "}
          {appeal.submittedAt
            ? new Date(appeal.submittedAt).toLocaleString()
            : "—"}
        </p>
      </header>

      <section className="rounded border border-gray-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-medium">Subject</h2>
        <p>
          <strong>Type:</strong> {appeal.subject.type}
        </p>
        <p>
          <strong>Ref:</strong>{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">
            {appeal.subject.ref}
          </code>
        </p>
        <p>
          <strong>Appellant:</strong>{" "}
          <span className="font-mono text-xs">{appeal.appellantUid}</span>
        </p>
        {appeal.originalActorUid && (
          <p>
            <strong>Original actor:</strong>{" "}
            <span className="font-mono text-xs">{appeal.originalActorUid}</span>
          </p>
        )}
      </section>

      <section className="rounded border border-gray-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-medium">Appellant statement</h2>
        <p className="whitespace-pre-wrap text-gray-800">{appeal.body}</p>
      </section>

      {!isPending && (
        <section className="rounded border border-gray-200 bg-gray-50 p-4 text-sm">
          <h2 className="mb-2 font-medium">Decision</h2>
          <p>
            <strong>{appeal.decision}</strong> by{" "}
            <span className="font-mono text-xs">{appeal.decidedBy}</span> on{" "}
            {appeal.decidedAt
              ? new Date(appeal.decidedAt).toLocaleString()
              : "—"}
          </p>
          {appeal.reasoning && (
            <p className="mt-2 whitespace-pre-wrap">{appeal.reasoning}</p>
          )}
        </section>
      )}

      {isPending && (
        <section className="rounded border border-gray-200 bg-white p-4 text-sm">
          <h2 className="mb-3 font-medium">Decide</h2>
          <p className="mb-3 text-xs text-amber-700">
            ⚠️ If you took the original moderation action, the API will reject
            this with <code>self_review_required</code>. Escalate to another
            admin.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Outcome</span>
            <select
              value={decision}
              onChange={(e) =>
                setDecision(e.target.value as "upheld" | "reversed")
              }
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            >
              <option value="upheld">
                upheld — original action stands
              </option>
              <option value="reversed">
                reversed — undo the moderation action
              </option>
            </select>
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-gray-700">
              Reasoning (≥ 50 chars; recorded in audit log)
            </span>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
              placeholder="Explain the rationale — what evidence you reviewed, why this outcome."
            />
            <span className="mt-1 block text-xs text-gray-500">
              {reasoning.length} / 50 chars minimum
            </span>
          </label>
          <button
            type="button"
            onClick={decide}
            disabled={submitting || reasoning.trim().length < 50}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit decision"}
          </button>
        </section>
      )}
    </div>
  );
}
