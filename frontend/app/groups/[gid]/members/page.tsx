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
    return <p className="p-4 text-sm text-gray-500">Loading…</p>;
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
          className="text-sm text-blue-600 hover:underline"
        >
          Back
        </Link>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        {leaderCount} {leaderCount === 1 ? "leader" : "leaders"} ·{" "}
        {members.length} total
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <ul className="divide-y divide-gray-200 rounded border border-gray-200">
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
                <code className="text-xs text-gray-500">{m.uid}</code>
                <div className="mt-1 flex gap-1">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      m.role === "leader"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {m.role}
                  </span>
                  {isFounderRow && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      founder
                    </span>
                  )}
                  {isSelf && (
                    <span className="rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-500">
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
                      className="rounded border border-blue-300 px-3 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Promote
                    </button>
                  )}
                  {m.role === "leader" && !isFounderRow && (
                    <button
                      type="button"
                      onClick={() => demote(m.uid)}
                      disabled={pending !== null}
                      className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Demote
                    </button>
                  )}
                  {m.role === "leader" && !isFounderRow && isFounder && (
                    <button
                      type="button"
                      onClick={() => transferFounder(m.uid)}
                      disabled={pending !== null}
                      className="rounded border border-amber-300 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
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
