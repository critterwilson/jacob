"use client";

import { useState } from "react";

import { Banner, Button, Card, Heading } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  type ExportStatus,
  useExportStatus,
} from "@/lib/hooks/useExportStatus";

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
      await apiPost("/api/account/export", {});
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.code || `HTTP ${e.status}`);
      } else {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onDownload = async () => {
    if (!user || !job.jobId || job.status !== "ready") return;
    // The download endpoint redirects to a signed GCS URL; we follow the
    // redirect and navigate the window to the final URL. lib/api.ts hides
    // the underlying Response (returns parsed JSON), so this stays as a
    // raw fetch — we need `res.redirected` / `res.url` semantics.
    const token = await user.getIdToken();
    // eslint-disable-next-line no-restricted-syntax
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
    <div className="mx-auto max-w-xl space-y-5 px-4 py-10">
      <Heading level={1} size="md">
        Export your data
      </Heading>
      <p className="text-body-sm text-cream-muted">
        Request a copy of the data we hold about you. The bundle is a single
        gzipped JSON file with your profile, messages, mentions, reactions,
        memberships, mute and block lists, and audit history. Photos are
        linked rather than embedded.
      </p>
      <p className="text-body-sm text-cream-muted">
        Exports usually finish within a few minutes. We&apos;ll email you when
        it&apos;s ready, and the download link expires after 7 days. After
        that, request a new export.
      </p>

      <Card surface="raised" padding="md" className="space-y-3">
        <h2 className="text-body font-semibold text-cream">Current status</h2>
        <p className="text-body-sm text-cream">{statusLabel(job.status)}</p>
        {job.status !== "none" && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-caption text-cream-muted">
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
      </Card>

      {error && (
        <Banner tone="error">
          {error === "export_in_flight"
            ? "An export is already in progress for this account."
            : error === "export_disabled"
              ? "Data export is temporarily unavailable. Please try again later."
              : error}
        </Banner>
      )}

      <div className="flex flex-wrap gap-3">
        {job.status === "ready" && job.downloadUrl && (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void onDownload()}
          >
            Download my data
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={submitting}
          disabled={!canRequest || submitting}
          onClick={() => void onRequest()}
        >
          {submitting
            ? "Requesting…"
            : job.status === "ready" || job.status === "expired"
              ? "Request a new export"
              : "Request export"}
        </Button>
      </div>

      {job.status === "ready" && job.downloadUrl && (
        <Card surface="raised" padding="sm" className="space-y-2">
          <p className="text-caption font-semibold text-cream">
            Backup link (in case you lose this page or the email):
          </p>
          <code className="block break-all rounded bg-ink-overlay p-2 font-mono text-caption text-cream">
            {job.downloadUrl}
          </code>
          <p className="text-caption text-cream-muted">
            Treat this link as a credential — anyone who has it can download
            your bundle.
          </p>
        </Card>
      )}
    </div>
  );
}
