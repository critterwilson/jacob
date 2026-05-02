"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { useDeletionStatus } from "@/lib/hooks/useDeletionStatus";

function formatFinalizeDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function DeletionBanner() {
  const { user } = useAuth();
  const { pending, finalizeAt } = useDeletionStatus(user?.uid);

  if (!pending || !finalizeAt) return null;

  return (
    <div
      role="alert"
      className="border-b border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <span>
          Your account is scheduled for deletion on{" "}
          <strong>{formatFinalizeDate(finalizeAt)}</strong>.
        </span>
        <Link
          href="/settings/delete-account"
          className="shrink-0 rounded border border-red-400 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
