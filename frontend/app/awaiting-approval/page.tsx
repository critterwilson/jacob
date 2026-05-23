"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { safeNext } from "@/lib/safe-redirect";

/**
 * Legacy ADR 0012 route. The platform-wide application queue is
 * retired by ADR 0015; new signups never land here. We keep the path
 * reachable so old bookmarks / signed-in tabs don't 404 — anyone who
 * hits it is bounced to /home (or the original `?next=` target).
 */
function RedirectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dest = safeNext(searchParams.get("next")) ?? "/home";

  useEffect(() => {
    router.replace(dest);
  }, [router, dest]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-ink">
      <span className="text-body-sm text-cream-muted" role="status">
        Loading…
      </span>
    </main>
  );
}

export default function AwaitingApprovalPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center bg-ink">
          <span className="text-body-sm text-cream-muted" role="status">
            Loading…
          </span>
        </main>
      }
    >
      <RedirectContent />
    </Suspense>
  );
}
