"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { useMembers } from "@/lib/hooks/useMembers";

type Props = { params: { gid: string } };

/**
 * Group members page. Members see the list; leaders also get
 * promote / demote / transfer-founder controls.
 */
export default function MembersPage({ params }: Props) {
  const { gid } = params;
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { members, loading: membersLoading, refresh } = useMembers(gid);
  const { group } = useGroup(gid);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  const callApi = async (path: string, body?: object) => {
    if (!user) return false;
    setPending(path);
    setError(null);
    try {
      await apiPost(path, body);
      // Refresh the member list so the role badge reflects the change.
      await refresh();
      return true;
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message || `HTTP ${e.status}`
          : "Network error",
      );
      return false;
    } finally {
      setPending(null);
    }
  };

  const promote = (uid: string) =>
    void callApi(`/api/groups/${gid}/leaders/${uid}/promote`);
  const demote = (uid: string) =>
    void callApi(`/api/groups/${gid}/leaders/${uid}/demote`);
  const transferFounder = (uid: string) =>
    void callApi(`/api/groups/${gid}/founder/transfer`, { targetUid: uid });

  if (authLoading || membersLoading) {
    return <p className="p-4 text-sm text-cream-muted">Loading…</p>;
  }
  if (!user) return null;

  const myMember = members.find((m) => m.uid === user.uid);
  const isLeader = myMember?.role === "leader";
  const isFounder = group?.founderUid === user.uid;
  const leaderCount = members.filter((m) => m.role === "leader").length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{group?.name ?? "Group"} members</h1>
        <Link
          href={`/groups/${gid}`}
          className="text-sm text-gold hover:underline"
        >
          Back
        </Link>
      </div>
      <p className="mb-6 text-sm text-cream-muted">
        {leaderCount} {leaderCount === 1 ? "leader" : "leaders"} ·{" "}
        {members.length} total
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded bg-terracotta/10 p-3 text-sm text-terracotta"
        >
          {error}
        </p>
      )}

      <ul className="divide-y divide-gray-200 rounded border border-line">
        {members.map((m) => {
          const isFounderRow = group?.founderUid === m.uid;
          const isSelf = m.uid === user.uid;
          return (
            <li
              key={m.uid}
              className="flex items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.displayName}</p>
                <code className="text-xs text-cream-muted">{m.uid}</code>
                <div className="mt-1 flex gap-1">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      m.role === "leader"
                        ? "bg-gold/15 text-cream"
                        : "bg-ink-overlay text-cream-muted"
                    }`}
                  >
                    {m.role}
                  </span>
                  {isFounderRow && (
                    <span className="rounded bg-parchment-amber/20 px-2 py-0.5 text-xs font-medium text-parchment-amber">
                      founder
                    </span>
                  )}
                  {isSelf && (
                    <span className="rounded bg-ink-raised px-2 py-0.5 text-xs text-cream-muted">
                      you
                    </span>
                  )}
                </div>
              </div>
              {isLeader && (
                <div className="flex flex-wrap gap-2">
                  {m.role === "member" && (
                    <button
                      type="button"
                      onClick={() => promote(m.uid)}
                      disabled={pending !== null}
                      className="rounded border border-line px-3 py-1 text-xs text-gold hover:bg-gold/15 disabled:opacity-50"
                    >
                      Promote
                    </button>
                  )}
                  {m.role === "leader" && !isFounderRow && (
                    <button
                      type="button"
                      onClick={() => demote(m.uid)}
                      disabled={pending !== null}
                      className="rounded border border-line px-3 py-1 text-xs text-cream-muted hover:bg-ink-raised disabled:opacity-50"
                    >
                      Demote
                    </button>
                  )}
                  {m.role === "leader" && !isFounderRow && isFounder && (
                    <button
                      type="button"
                      onClick={() => transferFounder(m.uid)}
                      disabled={pending !== null}
                      className="rounded border border-parchment-amber/50 px-3 py-1 text-xs text-parchment-amber hover:bg-parchment-amber/15 disabled:opacity-50"
                    >
                      Make founder
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
