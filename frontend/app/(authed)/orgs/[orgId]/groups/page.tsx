"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useOrgGroups } from "@/lib/hooks/useOrgGroups";

export default function OrgGroupsPage() {
  const params = useParams();
  const orgId = String(
    Array.isArray(params?.orgId) ? params.orgId[0] : (params?.orgId ?? ""),
  );
  const { groups, loading, error, reload } = useOrgGroups(orgId);

  const [attachGid, setAttachGid] = useState("");
  const [consentToken, setConsentToken] = useState("");
  const [pending, setPending] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachInfo, setAttachInfo] = useState<string | null>(null);

  const attach = async () => {
    if (!attachGid) return;
    setPending(true);
    setAttachError(null);
    setAttachInfo(null);
    try {
      const res = await apiPost<{
        consentRequired: boolean;
        consentLinkSent: boolean;
      }>(`/api/orgs/${encodeURIComponent(orgId)}/groups/${encodeURIComponent(attachGid)}/attach`, {
        consentToken: consentToken || undefined,
      });
      if (res.consentRequired) {
        setAttachInfo(
          "Consent email sent to group leaders. Paste the code they forward to complete the attachment.",
        );
      } else {
        setAttachInfo(`Attached group ${attachGid}.`);
        setAttachGid("");
        setConsentToken("");
        reload();
      }
    } catch (e) {
      setAttachError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to attach",
      );
    } finally {
      setPending(false);
    }
  };

  const detach = async (gid: string) => {
    if (!confirm(`Detach group ${gid} from this org?`)) return;
    try {
      await apiPost(`/api/orgs/${encodeURIComponent(orgId)}/groups/${encodeURIComponent(gid)}/detach`, {});
      reload();
    } catch (e) {
      alert(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to detach",
      );
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <Link href={`/orgs/${orgId}`} className="text-xs text-cream-muted hover:text-cream-muted">
          ← Org dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Groups</h1>
      </header>

      <section className="rounded border border-line bg-ink-raised p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cream-muted">
          Attach existing group
        </h2>
        <p className="mb-2 text-xs text-cream-muted">
          The group&apos;s leader receives a consent email with a code. Paste
          that code here on the second attempt.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs text-cream-muted">Group ID</label>
            <input
              value={attachGid}
              onChange={(e) => setAttachGid(e.target.value)}
              placeholder="g-xxxxxxxx"
              className="w-full rounded border border-line px-2 py-1 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-cream-muted">
              Consent code (optional)
            </label>
            <input
              value={consentToken}
              onChange={(e) => setConsentToken(e.target.value)}
              placeholder="from leader email"
              className="w-full rounded border border-line px-2 py-1 text-sm font-mono"
            />
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={attach}
            loading={pending}
            disabled={!attachGid || pending}
          >
            {pending ? "…" : "Attach"}
          </Button>
        </div>
        {attachInfo && <p className="mt-2 text-xs text-sage">{attachInfo}</p>}
        {attachError && (
          <p className="mt-2 text-xs text-terracotta">{attachError}</p>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-terracotta">{error.message}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-cream-muted">No groups attached yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-cream-muted">
              <th className="py-2">Name</th>
              <th>Members</th>
              <th>Created</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.gid} className="border-b border-line">
                <td className="py-2">
                  <Link
                    href={`/groups/${g.gid}/chat`}
                    className="text-gold hover:underline"
                  >
                    {g.name}
                  </Link>
                  <p className="font-mono text-xs text-cream-muted">{g.gid}</p>
                </td>
                <td>{g.memberCount}</td>
                <td className="text-xs text-cream-muted">
                  {g.createdAt
                    ? new Date(g.createdAt).toLocaleDateString()
                    : "—"}
                </td>
                <td>
                  {g.archivedAt ? (
                    <span className="rounded bg-ink-overlay px-1 py-0.5 text-xs">
                      archived
                    </span>
                  ) : (
                    <span className="rounded bg-sage/20 px-1 py-0.5 text-xs text-sage">
                      active
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => detach(g.gid)}
                  >
                    Detach
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
