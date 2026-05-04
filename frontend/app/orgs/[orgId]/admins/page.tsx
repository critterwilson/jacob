"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ApiError, apiDelete, apiPost } from "@/lib/api";
import { useOrgAdmins } from "@/lib/hooks/useOrgAdmins";

export default function OrgAdminsPage() {
  const params = useParams();
  const orgId = String(
    Array.isArray(params?.orgId) ? params.orgId[0] : (params?.orgId ?? ""),
  );
  const { admins, loading, error, reload } = useOrgAdmins(orgId);
  const [newUid, setNewUid] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const add = async () => {
    if (!newUid) return;
    setPending(true);
    setActionError(null);
    try {
      await apiPost(`/api/orgs/${encodeURIComponent(orgId)}/admins`, {
        uid: newUid,
      });
      setNewUid("");
      reload();
    } catch (e) {
      setActionError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to add",
      );
    } finally {
      setPending(false);
    }
  };

  const remove = async (uid: string) => {
    if (!confirm(`Remove ${uid} from this org's admins?`)) return;
    setActionError(null);
    try {
      await apiDelete(
        `/api/orgs/${encodeURIComponent(orgId)}/admins/${encodeURIComponent(uid)}`,
      );
      reload();
    } catch (e) {
      setActionError(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Failed to remove",
      );
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <Link href={`/orgs/${orgId}`} className="text-xs text-gray-500 hover:text-gray-700">
          ← Org dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Admins</h1>
      </header>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Add admin
        </h2>
        <div className="flex gap-2">
          <input
            value={newUid}
            onChange={(e) => setNewUid(e.target.value)}
            placeholder="user UID"
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
          />
          <button
            type="button"
            onClick={add}
            disabled={!newUid || pending}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {actionError && (
          <p className="mt-2 text-xs text-red-600">{actionError}</p>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error.message}</p>
      ) : admins.length === 0 ? (
        <p className="text-sm text-gray-500">No admins yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2">UID</th>
              <th>Added by</th>
              <th>Added at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.uid} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs">{a.uid}</td>
                <td className="font-mono text-xs">{a.addedBy ?? "—"}</td>
                <td className="text-xs text-gray-500">
                  {a.addedAt ? new Date(a.addedAt).toLocaleString() : "—"}
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => remove(a.uid)}
                    className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-gray-500">
        Removing the last admin is refused (returns 409 last_admin).
      </p>
    </div>
  );
}
