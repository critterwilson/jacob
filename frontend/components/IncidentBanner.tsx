"use client";

// T59 — non-dismissible incident banner. Renders at the top of every
// authed page (mounted in `app/(authed)/layout.tsx` if present, else
// the root layout). Severity drives the colour:
//   SEV1 — red
//   SEV2 — amber
//   SEV3 — blue (informational; rarely shown — most SEV3s don't
//   warrant a banner)

import { useActiveIncidents } from "@/lib/hooks/useActiveIncidents";

const SEVERITY_STYLES: Record<string, string> = {
  SEV1: "bg-red-600 text-white",
  SEV2: "bg-amber-500 text-white",
  SEV3: "bg-blue-600 text-white",
};

export function IncidentBanner() {
  const { incidents } = useActiveIncidents();
  if (incidents.length === 0) return null;

  // Show the highest-severity incident. Multiple concurrent incidents
  // are rare; one banner avoids a stack of competing alerts.
  const top = [...incidents].sort((a, b) => sevRank(a.severity) - sevRank(b.severity))[0];
  const cls = SEVERITY_STYLES[top.severity] ?? SEVERITY_STYLES.SEV3;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`w-full px-4 py-2 text-sm shadow ${cls}`}
    >
      <div className="mx-auto flex max-w-5xl items-baseline gap-3">
        <span className="rounded bg-black/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
          {top.severity}
        </span>
        <strong className="font-medium">{top.title}</strong>
        {top.body && (
          <span className="hidden truncate opacity-90 sm:inline">{top.body}</span>
        )}
      </div>
    </div>
  );
}

function sevRank(s: string): number {
  if (s === "SEV1") return 0;
  if (s === "SEV2") return 1;
  return 2;
}
