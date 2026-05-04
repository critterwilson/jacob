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
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    );
  }
  if (error?.status === 403) {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-700">
          You don&apos;t have permission to view this org.
        </p>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-700">Org not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {org.audience}
          </p>
          <h1 className="text-3xl font-semibold">{org.name}</h1>
          <p className="mt-1 text-sm text-gray-600">{org.description}</p>
        </div>
        <nav className="space-x-2 text-sm">
          <Link
            href={`/orgs/${orgId}/groups`}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
          >
            Groups
          </Link>
          <Link
            href={`/orgs/${orgId}/admins`}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
          >
            Admins
          </Link>
          <Link
            href={`/orgs/${orgId}/analytics`}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
          >
            Analytics
          </Link>
          <Link
            href={`/orgs/${orgId}/settings`}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
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

      <section className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          About this org
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-y-1">
          <dt className="text-gray-500">Slug</dt>
          <dd className="font-mono text-xs">{org.slug}</dd>
          <dt className="text-gray-500">Audience</dt>
          <dd>{org.audience}</dd>
          <dt className="text-gray-500">Created</dt>
          <dd>
            {org.createdAt
              ? new Date(org.createdAt).toLocaleDateString()
              : "—"}
          </dd>
          {org.customSubdomain && (
            <>
              <dt className="text-gray-500">Subdomain</dt>
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
        highlight ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
