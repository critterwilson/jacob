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
      className="border-b border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta"
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <span>
          Your account is scheduled for deletion on{" "}
          <strong>{formatFinalizeDate(finalizeAt)}</strong>.
        </span>
        <Link
          href="/settings/delete-account"
          className="shrink-0 rounded border border-terracotta bg-ink-raised px-3 py-1 text-xs font-medium text-terracotta hover:bg-ink-overlay"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
