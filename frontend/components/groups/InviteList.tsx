"use client";

import { useState } from "react";

import { Banner } from "@/components/ui";
import { ApiError, apiDelete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Invite } from "@/lib/hooks/useInvites";

type Status = "active" | "expired" | "revoked" | "used_up";

function parseIso(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function getStatus(invite: Invite): Status {
  if (invite.revokedAt) return "revoked";
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses)
    return "used_up";
  const expiresMs = parseIso(invite.expiresAt);
  if (expiresMs !== null && expiresMs < Date.now()) return "expired";
  return "active";
}

function formatRelative(ts: string | null): string {
  const ms = parseIso(ts);
  if (ms === null) return "—";
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatExpiry(invite: Invite): string {
  if (!invite.expiresAt) return "Never";
  const ms = parseIso(invite.expiresAt);
  if (ms === null) return "—";
  const diff = ms - Date.now();
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
  active: "bg-sage/20 text-sage",
  expired: "bg-parchment-amber/20 text-parchment-amber",
  revoked: "bg-ink text-cream-dim",
  used_up: "bg-ink text-cream-dim",
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
      await apiDelete(`/api/groups/${gid}/invites/${inviteId}`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message || "Failed to revoke invite."
          : "Something went wrong.",
      );
    } finally {
      setRevoking(null);
    }
  };

  if (invites.length === 0) {
    return <p className="text-body-sm text-cream-muted">No invites yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <Banner tone="error">{error}</Banner>}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-line text-left text-eyebrow uppercase tracking-wider text-cream-dim">
              <th className="py-2 pr-4 font-normal">Code</th>
              <th className="py-2 pr-4 font-normal">Expires</th>
              <th className="py-2 pr-4 font-normal">Uses left</th>
              <th className="py-2 pr-4 font-normal">Last used</th>
              <th className="py-2 pr-4 font-normal">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const status = getStatus(inv);
              return (
                <tr
                  key={inv.inviteId}
                  className="border-b border-line last:border-0"
                >
                  <td className="py-2 pr-4 font-mono text-cream">{inv.code}</td>
                  <td className="py-2 pr-4 text-cream-muted">
                    {formatExpiry(inv)}
                  </td>
                  <td className="py-2 pr-4 text-cream">
                    {formatUsesRemaining(inv)}
                  </td>
                  <td className="py-2 pr-4 text-cream-muted">
                    {formatRelative(inv.lastUsedAt)}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-caption font-medium ${STATUS_CLASSES[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  </td>
                  <td className="py-2">
                    {status === "active" && (
                      <button
                        onClick={() => void revoke(inv.inviteId)}
                        disabled={revoking === inv.inviteId}
                        className="rounded-sm text-caption text-terracotta transition-colors duration-fast hover:opacity-80 focus:outline-none focus-visible:shadow-glow-gold disabled:opacity-50"
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
