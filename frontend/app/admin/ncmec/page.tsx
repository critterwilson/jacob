"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

async function authFetch(token: string, path: string, init?: RequestInit) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
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
      const token = await user.getIdToken();
      const res = await authFetch(token, "/api/admin/ncmec/pending");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCases(data.cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
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
      const token = await user.getIdToken();
      const res = await authFetch(token, `/api/admin/ncmec/${caseId}/submit`, {
        method: "POST",
        body: JSON.stringify({ confirm: "SUBMIT" }),
      });
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
      await load();
      setActionState((s) => ({ ...s, [caseId]: "done" }));
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [caseId]: e instanceof Error ? e.message : "error",
      }));
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
      const token = await user.getIdToken();
      const res = await authFetch(token, `/api/admin/ncmec/${caseId}/withdraw`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setActionState((s) => ({
        ...s,
        [caseId]: e instanceof Error ? e.message : "error",
      }));
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">NCMEC reporting queue</h1>
        <p className="mt-1 text-sm text-amber-700">
          ⚠️ Submitting a case files an external legal report. Read{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">
            docs/runbooks/csam-incident.md
          </code>{" "}
          before clicking Submit.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-gray-500">No pending cases.</p>
      ) : (
        <ul className="space-y-3">
          {cases.map((c) => (
            <li
              key={c.caseId}
              className="rounded border border-gray-200 bg-white p-4 text-sm"
            >
              <p className="font-mono text-xs text-gray-500">{c.caseId}</p>
              <p>
                <strong>Hash source:</strong> {c.hashSource}
              </p>
              <p>
                <strong>Hash:</strong>{" "}
                <code className="rounded bg-gray-100 px-1 text-xs">
                  {c.hashValue.slice(0, 16)}…
                </code>
              </p>
              <p>
                <strong>Evidence path:</strong>{" "}
                <code className="rounded bg-gray-100 px-1 text-xs">
                  {c.evidence.gcsPath}
                </code>{" "}
                · sha256{" "}
                <code className="rounded bg-gray-100 px-1 text-[10px]">
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
                  className="rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-800"
                >
                  Submit (legal action)
                </button>
                <button
                  type="button"
                  onClick={() => withdraw(c.caseId)}
                  className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
                >
                  Withdraw (false positive)
                </button>
                {actionState[c.caseId] && (
                  <span className="self-center text-xs text-gray-500">
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
