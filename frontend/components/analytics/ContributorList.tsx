"use client";

import type { ContributorItem } from "@/lib/hooks/useAnalytics";

type Props = { contributors: ContributorItem[] };

export function ContributorList({ contributors }: Props) {
  if (contributors.length === 0) {
    return <p className="text-sm text-cream-muted">No contributors this period.</p>;
  }

  return (
    <ol className="space-y-2">
      {contributors.map((c, i) => (
        <li key={c.uid} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <span className="w-5 text-right font-mono text-cream-muted">{i + 1}.</span>
            <span className="font-medium">{c.displayName || c.uid}</span>
          </span>
          <span className="tabular-nums text-cream-muted">{c.count} messages</span>
        </li>
      ))}
    </ol>
  );
}
