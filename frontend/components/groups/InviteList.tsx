"use client";

import { useState } from "react";
import type { Timestamp } from "firebase/firestore";

import { useAuth } from "@/lib/auth-context";
import type { Invite } from "@/lib/hooks/useInvites";

type Status = "active" | "expired" | "revoked" | "used_up";

function getStatus(invite: Invite): Status {
  if (invite.revokedAt) return "revoked";
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return "used_up";
  if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) return "expired";
  return "active";
}

function formatRelative(ts: Timestamp | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts.toDate().getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatExpiry(invite: Invite): string {
  if (!invite.expiresAt) return "Never";
  const diff = invite.expiresAt.toDate().getTime() - Date.now();
  if (diff <= 0) return "—";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatUsesRemaining(invite: Invite): string {
  if (invite.maxUses === null) return "∞";
  return String(Math.max(0, invite.maxUses - invite.useCount));
}

const STATUS_LABELS: Record<Status, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  used_up: "Used up",
};

const STATUS_CLASSES: Record<Status, string> = {
  active: "bg-green-100 text-green-700",
  expired: "bg-yellow-100 text-yellow-700",
  revoked: "bg-gray-100 text-gray-500",
  used_up: "bg-gray-100 text-gray-500",
};

type Props = { gid: string; invites: Invite[] };

export function InviteList({ gid, invites }: Props) {
  const { user } = useAuth();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (inviteId: string) => {
    if (!user) return;
    setRevoking(inviteId);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/groups/${gid}/invites/${inviteId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error?.message ?? "Failed to revoke invite.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setRevoking(null);
    }
  };

  if (invites.length === 0) {
    return <p className="text-sm text-gray-500">No invites yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Expires</th>
              <th className="py-2 pr-4">Uses left</th>
              <th className="py-2 pr-4">Last used</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const status = getStatus(inv);
              return (
                <tr key={inv.inviteId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono">{inv.code}</td>
                  <td className="py-2 pr-4 text-gray-600">{formatExpiry(inv)}</td>
                  <td className="py-2 pr-4">{formatUsesRemaining(inv)}</td>
                  <td className="py-2 pr-4 text-gray-600">{formatRelative(inv.lastUsedAt)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  </td>
                  <td className="py-2">
                    {status === "active" && (
                      <button
                        onClick={() => void revoke(inv.inviteId)}
                        disabled={revoking === inv.inviteId}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        {revoking === inv.inviteId ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
