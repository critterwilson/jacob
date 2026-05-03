"use client";

import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";

import { firestore } from "@/lib/firebase";

/**
 * T38 — live status of the user's most recent self-serve export job.
 *
 * Listens directly to `users/{uid}/exports`. The collection is
 * server-only-write (rules tested in `firestore/tests/exports.rules.test.ts`),
 * so the listener can never be tricked into seeing a job written by
 * anyone other than the backend processor.
 */

export type ExportStatus =
  | "none"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "expired";

export type ExportJob = {
  jobId: string;
  status: ExportStatus;
  requestedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  failureReason: string | null;
  byteCount: number | null;
  downloadUrl: string | null;
  schemaVersion: number;
};

const DEFAULT: ExportJob = {
  jobId: "",
  status: "none",
  requestedAt: null,
  completedAt: null,
  expiresAt: null,
  failureReason: null,
  byteCount: null,
  downloadUrl: null,
  schemaVersion: 1,
};

function tsToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const ts = value as Partial<Timestamp> & { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate();
  return null;
}

function deriveStatus(data: Record<string, unknown>): ExportStatus {
  if (data.failedAt) return "failed";
  if (data.completedAt) {
    const expiresAt = tsToDate(data.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) return "expired";
    return "ready";
  }
  if (data.startedAt) return "processing";
  return "queued";
}

export function useExportStatus(uid: string | undefined): ExportJob {
  const [job, setJob] = useState<ExportJob>(DEFAULT);

  useEffect(() => {
    if (!uid) {
      setJob(DEFAULT);
      return;
    }

    const exportsCol = collection(firestore, "users", uid, "exports");
    const unsub = onSnapshot(
      exportsCol,
      (snap) => {
        if (snap.empty) {
          setJob(DEFAULT);
          return;
        }
        // Pick the most recent job by `requestedAt`.
        let latest: { id: string; data: Record<string, unknown> } | null = null;
        let latestTs = -Infinity;
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const ts = tsToDate(data.requestedAt);
          const t = ts ? ts.getTime() : 0;
          if (t > latestTs || (t === latestTs && (!latest || d.id > latest.id))) {
            latestTs = t;
            latest = { id: d.id, data };
          }
        });
        if (!latest) {
          setJob(DEFAULT);
          return;
        }
        const { id: jobId, data } = latest as {
          id: string;
          data: Record<string, unknown>;
        };
        const completedAt = tsToDate(data.completedAt);
        const downloadUrlRaw = data.downloadUrl;
        const downloadUrl =
          typeof downloadUrlRaw === "string" && downloadUrlRaw ? downloadUrlRaw : null;
        const failureReasonRaw = data.failureReason;
        const failureReason =
          typeof failureReasonRaw === "string" ? failureReasonRaw : null;
        const byteCountRaw = data.byteCount;
        const byteCount =
          typeof byteCountRaw === "number" ? byteCountRaw : null;
        const schemaVersionRaw = data.schemaVersion;
        const schemaVersion =
          typeof schemaVersionRaw === "number" ? schemaVersionRaw : 1;
        setJob({
          jobId,
          status: deriveStatus(data),
          requestedAt: tsToDate(data.requestedAt),
          completedAt,
          expiresAt: tsToDate(data.expiresAt),
          failureReason,
          byteCount,
          downloadUrl,
          schemaVersion,
        });
      },
      () => {
        setJob(DEFAULT);
      },
    );

    return unsub;
  }, [uid]);

  return job;
}
