"use client";

import Link from "next/link";

import { useMyOrgs } from "@/lib/hooks/useMyOrgs";

export default function OrgsIndexPage() {
  const { orgs, loading } = useMyOrgs();

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Your organizations</h1>
        <p className="mt-1 text-sm text-cream-muted">
          Organizations you administer or belong to.
        </p>
      </header>

      {orgs.length === 0 ? (
        <div className="rounded border border-line bg-ink-raised p-8 text-center">
          <p className="text-sm text-cream-muted">
            You don&apos;t belong to any organizations yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orgs.map((org) => (
            <li key={org.orgId}>
              <Link
                href={`/orgs/${org.orgId}`}
                className="flex items-center justify-between rounded border border-line bg-ink-raised p-4 transition-colors hover:border-cream/30 hover:bg-ink-raised"
              >
                <div>
                  <p className="font-medium">{org.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-cream-muted">
                    {org.slug}
                  </p>
                </div>
                <span
                  className={
                    "rounded px-2 py-0.5 text-xs font-medium " +
                    (org.role === "admin"
                      ? "bg-gold/20 text-gold"
                      : "bg-ink text-cream-muted")
                  }
                >
                  {org.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
