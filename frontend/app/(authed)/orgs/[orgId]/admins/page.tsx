"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
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
        <Link href={`/orgs/${orgId}`} className="text-xs text-cream-muted hover:text-cream-muted">
          ← Org dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Admins</h1>
      </header>

      <section className="rounded border border-line bg-ink-raised p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cream-muted">
          Add admin
        </h2>
        <div className="flex gap-2">
          <input
            value={newUid}
            onChange={(e) => setNewUid(e.target.value)}
            placeholder="user UID"
            className="flex-1 rounded border border-line px-2 py-1 text-sm font-mono"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={add}
            loading={pending}
            disabled={!newUid || pending}
          >
            Add
          </Button>
        </div>
        {actionError && (
          <p className="mt-2 text-xs text-terracotta">{actionError}</p>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-cream-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-terracotta">{error.message}</p>
      ) : admins.length === 0 ? (
        <p className="text-sm text-cream-muted">No admins yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-cream-muted">
              <th className="py-2">UID</th>
              <th>Added by</th>
              <th>Added at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.uid} className="border-b border-line">
                <td className="py-2 font-mono text-xs">{a.uid}</td>
                <td className="font-mono text-xs">{a.addedBy ?? "—"}</td>
                <td className="text-xs text-cream-muted">
                  {a.addedAt ? new Date(a.addedAt).toLocaleString() : "—"}
                </td>
                <td className="text-right">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(a.uid)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-cream-muted">
        Removing the last admin is refused (returns 409 last_admin).
      </p>
    </div>
  );
}
