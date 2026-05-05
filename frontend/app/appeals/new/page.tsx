"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SUBJECT_TYPES = [
  { value: "message", label: "A message of mine that was hidden" },
  { value: "ban", label: "An account ban" },
  { value: "group_archive", label: "A group archive" },
] as const;

type SubjectType = (typeof SUBJECT_TYPES)[number]["value"];

export default function NewAppealPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialType =
    (searchParams.get("type") as SubjectType | null) ?? "message";
  const initialRef = searchParams.get("ref") ?? "";

  const [subjectType, setSubjectType] = useState<SubjectType>(initialType);
  const [subjectRef, setSubjectRef] = useState(initialRef);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/home");
  }, [user, authLoading, router]);

  const submit = async () => {
    if (!user) return;
    if (body.trim().length < 50) {
      setError("Statement must be at least 50 characters.");
      return;
    }
    if (!subjectRef.trim()) {
      setError("Subject reference is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API}/api/appeals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: { type: subjectType, ref: subjectRef.trim() },
          body,
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error?.message) msg = data.error.message;
        } catch {
          /* fall through */
        }
        throw new Error(msg);
      }
      const data = await res.json();
      router.replace(`/appeals/${data.appealId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Submit an appeal</h1>
        <p className="mt-1 text-sm text-cream-muted">
          A different admin from the one who took the original action will
          review your appeal within 7 days. You may submit one appeal per
          subject.
        </p>
      </header>

      {error && (
        <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
          {error}
        </div>
      )}

      <label className="block text-sm">
        <span className="font-medium text-cream">What are you appealing?</span>
        <select
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value as SubjectType)}
          className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 focus:outline-none focus-visible:shadow-glow-gold"
        >
          {SUBJECT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-cream">
          Subject reference
        </span>
        <input
          value={subjectRef}
          onChange={(e) => setSubjectRef(e.target.value)}
          placeholder={
            subjectType === "message"
              ? "groups/<groupId>/messages/<messageId>"
              : subjectType === "ban"
                ? "bans/<your uid>"
                : "groups/<groupId>"
          }
          className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 font-mono text-xs focus:outline-none focus-visible:shadow-glow-gold"
        />
        <span className="mt-1 block text-xs text-cream-muted">
          The notification you received about the moderation action contains
          this reference.
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-cream">
          Why do you think this was a mistake? (≥ 50 chars)
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="mt-1 w-full rounded border border-line bg-ink-raised px-2 py-1 focus:outline-none focus-visible:shadow-glow-gold"
          placeholder="Explain the context the original reviewer may have missed."
        />
        <span className="mt-1 block text-xs text-cream-muted">
          {body.length} / 50 chars minimum
        </span>
      </label>

      <button
        type="button"
        onClick={submit}
        disabled={submitting || body.trim().length < 50 || !subjectRef.trim()}
        className="rounded bg-gold px-4 py-2 text-sm text-ink hover:bg-gold-soft disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit appeal"}
      </button>
    </main>
  );
}
