"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

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
        <Link href={`/orgs/${orgId}`} className="text-xs text-gray-500 hover:text-gray-700">
          ← Org dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Groups</h1>
      </header>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Attach existing group
        </h2>
        <p className="mb-2 text-xs text-gray-500">
          The group&apos;s leader receives a consent email with a code. Paste
          that code here on the second attempt.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-500">Group ID</label>
            <input
              value={attachGid}
              onChange={(e) => setAttachGid(e.target.value)}
              placeholder="g-xxxxxxxx"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500">
              Consent code (optional)
            </label>
            <input
              value={consentToken}
              onChange={(e) => setConsentToken(e.target.value)}
              placeholder="from leader email"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            />
          </div>
          <button
            type="button"
            onClick={attach}
            disabled={!attachGid || pending}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            {pending ? "…" : "Attach"}
          </button>
        </div>
        {attachInfo && <p className="mt-2 text-xs text-green-700">{attachInfo}</p>}
        {attachError && (
          <p className="mt-2 text-xs text-red-600">{attachError}</p>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error.message}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-500">No groups attached yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2">Name</th>
              <th>Members</th>
              <th>Created</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.gid} className="border-b border-gray-100">
                <td className="py-2">
                  <Link
                    href={`/groups/${g.gid}/chat`}
                    className="text-blue-700 hover:underline"
                  >
                    {g.name}
                  </Link>
                  <p className="font-mono text-xs text-gray-500">{g.gid}</p>
                </td>
                <td>{g.memberCount}</td>
                <td className="text-xs text-gray-500">
                  {g.createdAt
                    ? new Date(g.createdAt).toLocaleDateString()
                    : "—"}
                </td>
                <td>
                  {g.archivedAt ? (
                    <span className="rounded bg-gray-200 px-1 py-0.5 text-xs">
                      archived
                    </span>
                  ) : (
                    <span className="rounded bg-green-100 px-1 py-0.5 text-xs text-green-700">
                      active
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => detach(g.gid)}
                    className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                  >
                    Detach
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
