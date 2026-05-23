"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

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

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

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
      const data = await apiGet<Appeal>(`/api/appeals/${appealId}`);
      setAppeal(data);
    } catch (e) {
      setError(errorMessage(e, "Failed to load"));
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
      await apiPost(`/api/admin/appeals/${appealId}/decide`, {
        decision,
        reasoning,
      });
      router.replace("/admin/appeals");
    } catch (e) {
      setError(errorMessage(e, "Decide failed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-sm text-cream-muted">Loading…</p>;
  if (error)
    return (
      <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
        {error}
      </div>
    );
  if (!appeal) return <p className="text-sm text-cream-muted">Not found.</p>;

  const isPending = appeal.decision === "pending";

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Appeal {appeal.appealId}</h1>
        <p className="mt-1 text-xs text-cream-muted">
          Submitted{" "}
          {appeal.submittedAt
            ? new Date(appeal.submittedAt).toLocaleString()
            : "—"}
        </p>
      </header>

      <section className="rounded border border-line bg-ink-raised p-4 text-sm">
        <h2 className="mb-2 font-medium">Subject</h2>
        <p>
          <strong>Type:</strong> {appeal.subject.type}
        </p>
        <p>
          <strong>Ref:</strong>{" "}
          <code className="rounded bg-ink-overlay px-1 text-xs">
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

      <section className="rounded border border-line bg-ink-raised p-4 text-sm">
        <h2 className="mb-2 font-medium">Appellant statement</h2>
        <p className="whitespace-pre-wrap text-cream">{appeal.body}</p>
      </section>

      {!isPending && (
        <section className="rounded border border-line bg-ink p-4 text-sm">
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
        <section className="rounded border border-line bg-ink-raised p-4 text-sm">
          <h2 className="mb-3 font-medium">Decide</h2>
          <p className="mb-3 text-xs text-parchment-amber">
            ⚠️ If you made the original decision on this content, ask another
            admin to handle this appeal — JACOB won&apos;t let the same person
            review their own action.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-cream">Outcome</span>
            <select
              value={decision}
              onChange={(e) =>
                setDecision(e.target.value as "upheld" | "reversed")
              }
              className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 focus:outline-none focus-visible:shadow-glow-gold"
            >
              <option value="upheld">
                Upheld — original action stands
              </option>
              <option value="reversed">
                Reversed — undo the moderation action
              </option>
            </select>
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-cream">Reasoning</span>
            <span className="mt-0.5 block text-caption text-cream-muted">
              Required (at least 50 characters). Saved in the audit log.
            </span>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 font-mono text-xs focus:outline-none focus-visible:shadow-glow-gold"
              placeholder="Explain the rationale — what evidence you reviewed, why this outcome."
            />
            <span className="mt-1 block text-xs text-cream-muted">
              {reasoning.length} / 50 chars minimum
            </span>
          </label>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button
              variant="primary"
              onClick={decide}
              loading={submitting}
              disabled={reasoning.trim().length < 50}
              fullWidth="mobile"
            >
              {submitting ? "Submitting…" : "Submit decision"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
