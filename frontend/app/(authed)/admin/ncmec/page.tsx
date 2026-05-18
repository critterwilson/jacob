"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type NcmecCase = {
  caseId: string;
  matchedAt: string | null;
  hashSource: string;
  hashValue: string;
  evidence: {
    gcsPath: string;
    sha256: string;
    sizeBytes: number;
    contentType: string | null;
  };
  reporterUid: string | null;
  suspectUid: string | null;
  status: "pending" | "submitted" | "withdrawn" | "failed";
  submittedBy: string | null;
  submittedAt: string | null;
  ncmecReportId: string | null;
  retainedUntil: string | null;
  withdrawnReason: string | null;
  failureReason: string | null;
};

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

export default function AdminNcmecPage() {
  const { user } = useAuth();
  const [cases, setCases] = useState<NcmecCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ cases: NcmecCase[] }>(
        "/api/admin/ncmec/pending",
      );
      setCases(data.cases);
    } catch (e) {
      setError(errorMessage(e, "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (caseId: string) => {
    if (!user) return;
    const typed = window.prompt(
      `Type SUBMIT to file the NCMEC report for case ${caseId}.\n\nThis is an external legal action — only proceed after counsel review per docs/runbooks/csam-incident.md.`,
    );
    if (typed !== "SUBMIT") return;
    setActionState((s) => ({ ...s, [caseId]: "loading" }));
    try {
      await apiPost(`/api/admin/ncmec/${caseId}/submit`, { confirm: "SUBMIT" });
      await load();
      setActionState((s) => ({ ...s, [caseId]: "done" }));
    } catch (e) {
      setActionState((s) => ({ ...s, [caseId]: errorMessage(e, "error") }));
    }
  };

  const withdraw = async (caseId: string) => {
    if (!user) return;
    const reason = window.prompt(
      `Reason for withdrawing case ${caseId} (≥ 50 chars). This will be recorded in the audit log.`,
    );
    if (!reason || reason.length < 50) {
      alert("Reason must be at least 50 characters.");
      return;
    }
    setActionState((s) => ({ ...s, [caseId]: "loading" }));
    try {
      await apiPost(`/api/admin/ncmec/${caseId}/withdraw`, { reason });
      await load();
    } catch (e) {
      setActionState((s) => ({ ...s, [caseId]: errorMessage(e, "error") }));
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">NCMEC reporting queue</h1>
        <p className="mt-1 text-sm text-parchment-amber">
          ⚠️ Submitting a case files an external legal report. Read{" "}
          <code className="rounded bg-ink-overlay px-1 text-xs">
            docs/runbooks/csam-incident.md
          </code>{" "}
          before clicking Submit.
        </p>
      </header>

      {error && (
        <div className="rounded border border-terracotta/40 bg-ink-raised px-4 py-2 text-sm text-terracotta">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-cream-muted">No pending cases.</p>
      ) : (
        <ul className="space-y-3">
          {cases.map((c) => (
            <li
              key={c.caseId}
              className="rounded border border-line bg-ink-raised p-4 text-sm"
            >
              <p className="font-mono text-xs text-cream-muted">{c.caseId}</p>
              <p>
                <strong>Hash source:</strong> {c.hashSource}
              </p>
              <p>
                <strong>Hash:</strong>{" "}
                <code className="rounded bg-ink-overlay px-1 text-xs">
                  {c.hashValue.slice(0, 16)}…
                </code>
              </p>
              <p>
                <strong>Evidence path:</strong>{" "}
                <code className="rounded bg-ink-overlay px-1 text-xs">
                  {c.evidence.gcsPath}
                </code>{" "}
                · sha256{" "}
                <code className="rounded bg-ink-overlay px-1 text-[10px]">
                  {c.evidence.sha256.slice(0, 16)}…
                </code>{" "}
                · {c.evidence.sizeBytes} bytes
              </p>
              {c.suspectUid && (
                <p>
                  <strong>Suspect:</strong>{" "}
                  <span className="font-mono text-xs">{c.suspectUid}</span>
                </p>
              )}
              <p>
                <strong>Retain until:</strong>{" "}
                {c.retainedUntil
                  ? new Date(c.retainedUntil).toLocaleDateString()
                  : "—"}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => submit(c.caseId)}
                  className="rounded bg-terracotta px-3 py-1 text-sm text-cream hover:bg-terracotta/90"
                >
                  Submit (legal action)
                </button>
                <button
                  type="button"
                  onClick={() => withdraw(c.caseId)}
                  className="rounded border border-line px-3 py-1 text-sm hover:bg-ink-overlay"
                >
                  Withdraw (false positive)
                </button>
                {actionState[c.caseId] && (
                  <span className="self-center text-xs text-cream-muted">
                    {actionState[c.caseId]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
