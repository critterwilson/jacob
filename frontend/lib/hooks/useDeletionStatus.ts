"use client";

import { doc, onSnapshot, Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";

import { firestore } from "@/lib/firebase";

const GRACE_PERIOD_DAYS = 14;

export type DeletionStatus = {
  pending: boolean;
  finalizeAt: Date | null;
  keepBody: boolean;
};

function tsToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const fn = (value as { toDate: () => Date }).toDate;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

export function useDeletionStatus(uid: string | undefined): DeletionStatus {
  const [status, setStatus] = useState<DeletionStatus>({
    pending: false,
    finalizeAt: null,
    keepBody: true,
  });

  useEffect(() => {
    if (!uid) {
      setStatus({ pending: false, finalizeAt: null, keepBody: true });
      return;
    }

    const unsub = onSnapshot(
      doc(firestore, "users", uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const requestedAt = tsToDate(data?.deletionRequestedAt);
        if (!requestedAt) {
          setStatus({ pending: false, finalizeAt: null, keepBody: true });
          return;
        }
        const finalizeAt = new Date(
          requestedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
        );
        setStatus({
          pending: true,
          finalizeAt,
          keepBody: data?.deletionKeepBody !== false,
        });
      },
      () => {
        setStatus({ pending: false, finalizeAt: null, keepBody: true });
      },
    );

    return unsub;
  }, [uid]);

  return status;
}
