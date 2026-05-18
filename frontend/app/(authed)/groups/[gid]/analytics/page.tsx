"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CadenceChart } from "@/components/analytics/CadenceChart";
import { ContributorList } from "@/components/analytics/ContributorList";
import { StickerMixChart } from "@/components/analytics/StickerMixChart";
import { useAuth } from "@/lib/auth-context";
import { useAnalytics } from "@/lib/hooks/useAnalytics";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";

type Props = { params: { gid: string } };
type Range = "7d" | "30d";

export default function AnalyticsPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { isLeader, loading: membershipLoading } = useGroupMembership(
    user?.uid,
    gid,
  );
  const [range, setRange] = useState<Range>("7d");

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  // Redirect non-leaders to the group page.
  useEffect(() => {
    if (!membershipLoading && !isLeader) {
      router.replace(`/groups/${gid}`);
    }
  }, [membershipLoading, isLeader, gid, router]);

  const { state } = useAnalytics(isLeader ? gid : "", range);

  if (authLoading || membershipLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user || !isLeader) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Group analytics</h1>
        <Link href={`/groups/${gid}`} className="text-sm text-gold hover:underline">
          ← Back
        </Link>
      </div>

      {/* Range toggle */}
      <div className="mb-8 inline-flex rounded border border-line text-sm" role="group">
        {(["7d", "30d"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={`px-4 py-1.5 first:rounded-l last:rounded-r ${
              range === r
                ? "bg-gold text-ink"
                : "bg-ink-raised text-cream-muted hover:bg-ink-raised"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {state.status === "loading" && <AnalyticsSkeleton />}

      {state.status === "error" && (
        <p role="alert" className="text-sm text-terracotta">
          {state.message}
        </p>
      )}

      {state.status === "ok" && state.data.totalMessages === 0 && (
        <p className="py-16 text-center text-cream-muted">
          Quiet week — see you next Sunday
        </p>
      )}

      {state.status === "ok" && state.data.totalMessages > 0 && (
        <div className="space-y-10">
          <p className="text-sm text-cream-muted">
            {state.data.totalMessages} messages in the last {range}
            {" · "}Includes through{" "}
            {new Date(state.data.generatedAt).toLocaleDateString()}
          </p>

          <section>
            <h2 className="mb-4 text-base font-semibold">Posting cadence</h2>
            <CadenceChart points={state.data.cadenceByDay} />
          </section>

          <section>
            <h2 className="mb-4 text-base font-semibold">Sticker mix</h2>
            {state.data.stickerMix.length === 0 ? (
              <p className="text-sm text-cream-muted">No stickers used this period.</p>
            ) : (
              <StickerMixChart items={state.data.stickerMix} />
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-semibold">Top contributors</h2>
            <ContributorList contributors={state.data.topContributors} />
          </section>
        </div>
      )}
    </main>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="animate-pulse space-y-8" aria-hidden>
      <div className="h-4 w-48 rounded bg-ink-overlay" />
      <div className="h-48 rounded bg-ink-overlay" />
      <div className="h-60 rounded bg-ink-overlay" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-4 rounded bg-ink-overlay" />
        ))}
      </div>
    </div>
  );
}
