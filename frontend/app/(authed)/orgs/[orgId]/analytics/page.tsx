"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useOrgAnalytics } from "@/lib/hooks/useOrgAnalytics";

export default function OrgAnalyticsPage() {
  const params = useParams();
  const orgId = String(
    Array.isArray(params?.orgId) ? params.orgId[0] : (params?.orgId ?? ""),
  );
  const [range, setRange] = useState<"7d" | "30d">("30d");
  const { data, loading, error } = useOrgAnalytics(orgId, range);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-cream-muted">
        Loading…
      </div>
    );
  }
  if (error?.status === 403) {
    return (
      <div className="p-6 text-sm text-cream-muted">
        You don&apos;t have permission to view this org&apos;s dashboard.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-6 text-sm text-cream-muted">
        No analytics data yet.
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <Link
            href={`/orgs/${orgId}`}
            className="text-xs text-cream-muted hover:text-cream-muted"
          >
            ← Org dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Org analytics</h1>
        </div>
        <div className="flex gap-2 text-xs">
          {(["7d", "30d"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded border px-3 py-1 ${
                range === r
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-line"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      <p className="text-xs text-cream-muted">
        Aggregated across the {data.groupCount} group
        {data.groupCount === 1 ? "" : "s"} attached to this org. No
        per-member numbers — see the runbook on what these signals are
        and aren&apos;t for.
      </p>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Groups" value={data.groupCount} />
        <Stat label="Active members" value={data.activeMembers} />
        <Stat label="Messages (approx)" value={data.totalMessages} />
      </section>

      <section className="rounded border border-line bg-ink-raised p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cream-muted">
          Event attendance
        </h2>
        {data.eventAttendance.length === 0 ? (
          <p className="mt-2 text-xs text-cream-muted">
            No events in the last {range}.
          </p>
        ) : (
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-cream-muted">
                <th className="py-1">Event</th>
                <th>Going</th>
                <th>Attended</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.eventAttendance.map((e) => {
                const rate =
                  e.rsvpGoing > 0 ? Math.round((e.attended / e.rsvpGoing) * 100) : 0;
                return (
                  <tr key={e.eventId} className="border-b border-line">
                    <td className="py-1">{e.title}</td>
                    <td>{e.rsvpGoing}</td>
                    <td>{e.attended}</td>
                    <td>{rate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded border border-line bg-ink-raised p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cream-muted">
          Sentiment trend
        </h2>
        <p className="text-xs text-cream-muted">
          Daily average of moderation severity. Aggregate only — no
          per-member signal here.
        </p>
        {data.sentimentTrend.length === 0 ? (
          <p className="mt-2 text-xs text-cream-muted">
            No moderation events in the last {range}.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {data.sentimentTrend.map((p) => (
              <li
                key={p.day}
                className="flex justify-between rounded bg-ink-raised px-2 py-1"
              >
                <span>{p.day}</span>
                <span>
                  avg severity {p.avgSeverity.toFixed(2)} · {p.count} events
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-line bg-ink-raised p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cream-muted">
          Per-group breakdown
        </h2>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-cream-muted">
              <th className="py-1">Group</th>
              <th>Members</th>
              <th>Messages (approx)</th>
              <th>Event attendance</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g) => (
              <tr key={g.gid} className="border-b border-line">
                <td className="py-1">
                  <Link
                    href={`/groups/${g.gid}/chat`}
                    className="text-gold hover:underline"
                  >
                    {g.name}
                  </Link>
                </td>
                <td>{g.activeMembers}</td>
                <td>{g.totalMessages}</td>
                <td>{g.eventAttended}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-ink-raised p-4">
      <p className="text-xs uppercase tracking-wide text-cream-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
