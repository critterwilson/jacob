"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { useOrg, useOrgDashboard } from "@/lib/hooks/useOrg";

export default function OrgDashboardPage() {
  const params = useParams();
  const orgId = String(
    Array.isArray(params?.orgId) ? params.orgId[0] : (params?.orgId ?? ""),
  );
  const { org, loading: orgLoading } = useOrg(orgId);
  const { dashboard, loading: dashboardLoading, error } = useOrgDashboard(orgId);

  if (orgLoading || dashboardLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </div>
    );
  }
  if (error?.status === 403) {
    return (
      <div className="p-8">
        <p className="text-sm text-cream-muted">
          You don&apos;t have permission to view this org.
        </p>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="p-8">
        <p className="text-sm text-cream-muted">Org not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-cream-muted">
            {org.audience}
          </p>
          <h1 className="text-3xl font-semibold">{org.name}</h1>
          <p className="mt-1 text-sm text-cream-muted">{org.description}</p>
        </div>
        <nav className="space-x-2 text-sm">
          <Link
            href={`/orgs/${orgId}/groups`}
            className="rounded border border-line px-3 py-1 hover:bg-ink-raised"
          >
            Groups
          </Link>
          <Link
            href={`/orgs/${orgId}/admins`}
            className="rounded border border-line px-3 py-1 hover:bg-ink-raised"
          >
            Admins
          </Link>
          <Link
            href={`/orgs/${orgId}/analytics`}
            className="rounded border border-line px-3 py-1 hover:bg-ink-raised"
          >
            Analytics
          </Link>
          <Link
            href={`/orgs/${orgId}/settings`}
            className="rounded border border-line px-3 py-1 hover:bg-ink-raised"
          >
            Settings
          </Link>
        </nav>
      </header>

      {dashboard && (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Groups" value={dashboard.groupCount} />
          <Stat label="Members" value={dashboard.memberCount} />
          <Stat label="Archived" value={dashboard.archivedGroupCount} />
          <Stat
            label="Pending mod"
            value={dashboard.pendingModerationCount}
            highlight={dashboard.pendingModerationCount > 0}
          />
        </section>
      )}

      <section className="rounded border border-line bg-ink-raised p-4 text-sm text-cream-muted">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-cream-muted">
          About this org
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-y-1">
          <dt className="text-cream-muted">Slug</dt>
          <dd className="font-mono text-xs">{org.slug}</dd>
          <dt className="text-cream-muted">Audience</dt>
          <dd>{org.audience}</dd>
          <dt className="text-cream-muted">Created</dt>
          <dd>
            {org.createdAt
              ? new Date(org.createdAt).toLocaleDateString()
              : "—"}
          </dd>
          {org.customSubdomain && (
            <>
              <dt className="text-cream-muted">Subdomain</dt>
              <dd className="font-mono text-xs">{org.customSubdomain}.jacob.app</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded border p-4 ${
        highlight ? "border-parchment-amber/50 bg-parchment-amber/15" : "border-line bg-ink-raised"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-cream-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
