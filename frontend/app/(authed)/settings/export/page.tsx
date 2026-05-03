"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { useExportStatus, type ExportStatus } from "@/lib/hooks/useExportStatus";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function statusLabel(s: ExportStatus): string {
  switch (s) {
    case "queued":
      return "Queued — waiting for the next processor run (every 5 minutes).";
    case "processing":
      return "Assembling your bundle…";
    case "ready":
      return "Ready to download.";
    case "failed":
      return "The export job failed. You can request a new one.";
    case "expired":
      return "The download link has expired. Request a new export to get a fresh one.";
    case "none":
    default:
      return "You haven't requested an export yet.";
  }
}

export default function ExportPage() {
  const { user } = useAuth();
  const job = useExportStatus(user?.uid);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRequest =
    job.status === "none" ||
    job.status === "ready" ||
    job.status === "failed" ||
    job.status === "expired";

  const onRequest = async () => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API}/api/account/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let code = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: { code?: string } };
          if (body?.error?.code) code = body.error.code;
        } catch {
          // ignore — keep the HTTP fallback above
        }
        throw new Error(code);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  const onDownload = async () => {
    if (!user || !job.jobId || job.status !== "ready") return;
    // Use the redirect endpoint so the bearer token never appears in
    // the URL bar; the backend re-checks ownership and the URL freshness.
    const token = await user.getIdToken();
    const res = await fetch(
      `${API}/api/account/export/${encodeURIComponent(job.jobId)}/download`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "follow",
      },
    );
    if (res.redirected) {
      window.location.href = res.url;
      return;
    }
    if (res.ok) {
      window.location.href = res.url;
      return;
    }
    setError(`Download failed (HTTP ${res.status})`);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Export your data</h1>
      <p className="mb-4 text-sm text-gray-700">
        Request a copy of the data we hold about you. The bundle is a single
        gzipped JSON file with your profile, messages, mentions, reactions,
        memberships, mute and block lists, and audit history. Photos are linked
        rather than embedded.
      </p>
      <p className="mb-6 text-sm text-gray-600">
        Exports usually finish within a few minutes. We&apos;ll email you when
        it&apos;s ready, and the download link expires after 7 days. After
        that, request a new export.
      </p>

      <div className="mb-6 rounded border border-gray-200 p-4 text-sm">
        <h2 className="mb-2 font-semibold">Current status</h2>
        <p className="mb-2 text-gray-700">{statusLabel(job.status)}</p>
        {job.status !== "none" && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-gray-600">
            <dt>Requested</dt>
            <dd>{formatDateTime(job.requestedAt)}</dd>
            {job.completedAt && (
              <>
                <dt>Completed</dt>
                <dd>{formatDateTime(job.completedAt)}</dd>
              </>
            )}
            {job.expiresAt && (
              <>
                <dt>Link expires</dt>
                <dd>{formatDateTime(job.expiresAt)}</dd>
              </>
            )}
            {job.byteCount !== null && (
              <>
                <dt>Size</dt>
                <dd>{formatBytes(job.byteCount)}</dd>
              </>
            )}
            {job.failureReason && (
              <>
                <dt>Failure</dt>
                <dd>{job.failureReason}</dd>
              </>
            )}
          </dl>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {error === "export_in_flight"
            ? "An export is already in progress for this account."
            : error === "export_disabled"
              ? "Data export is temporarily unavailable. Please try again later."
              : error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {job.status === "ready" && job.downloadUrl && (
          <button
            type="button"
            onClick={onDownload}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Download my data
          </button>
        )}
        <button
          type="button"
          disabled={!canRequest || submitting}
          onClick={onRequest}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {submitting
            ? "Requesting…"
            : job.status === "ready" || job.status === "expired"
              ? "Request a new export"
              : "Request export"}
        </button>
      </div>

      {job.status === "ready" && job.downloadUrl && (
        <div className="mt-6 rounded border border-gray-200 p-3 text-xs">
          <p className="mb-1 font-semibold text-gray-700">
            Backup link (in case you lose this page or the email):
          </p>
          <code className="block break-all rounded bg-gray-100 p-2 font-mono text-gray-700">
            {job.downloadUrl}
          </code>
          <p className="mt-2 text-gray-600">
            Treat this link as a credential — anyone who has it can download
            your bundle.
          </p>
        </div>
      )}
    </div>
  );
}
