"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { useMembers } from "@/lib/hooks/useMembers";
import { WellbeingFlagButton } from "@/components/moderation/WellbeingFlagButton";

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
                <div className="mt-1 flex gap-1">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      m.role === "leader"
                        ? "bg-gold/15 text-cream"
                        : "bg-ink-overlay text-cream-muted"
                    }`}
                  >
                    {m.role === "leader" ? "Leader" : "Member"}
                  </span>
                  {isFounderRow && (
                    <span className="rounded bg-parchment-amber/20 px-2 py-0.5 text-xs font-medium text-parchment-amber">
                      Founder
                    </span>
                  )}
                  {isSelf && (
                    <span className="rounded bg-ink-raised px-2 py-0.5 text-xs text-cream-muted">
                      You
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!isSelf && (
                  <WellbeingFlagButton
                    subjectUid={m.uid}
                    subjectName={m.displayName}
                    groupId={gid}
                    className="rounded border border-line px-3 py-1 text-xs text-cream-muted hover:bg-ink-raised"
                  />
                )}
                {isLeader && (
                  <>
                    {m.role === "member" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => promote(m.uid)}
                        disabled={pending !== null}
                      >
                        Promote
                      </Button>
                    )}
                    {m.role === "leader" && !isFounderRow && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => demote(m.uid)}
                        disabled={pending !== null}
                      >
                        Demote
                      </Button>
                    )}
                    {m.role === "leader" && !isFounderRow && isFounder && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => transferFounder(m.uid)}
                        disabled={pending !== null}
                      >
                        Make founder
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
