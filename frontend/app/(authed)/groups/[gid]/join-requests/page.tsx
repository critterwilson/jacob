"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useJoinRequests, type PendingRequest } from "@/lib/hooks/useJoinRequests";

type Props = { params: { gid: string } };

export default function JoinRequestsPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { group } = useGroup(gid);
  const { isLeader, loading: membershipLoading } = useGroupMembership(user?.uid, gid);
  const { state, refresh } = useJoinRequests(isLeader ? gid : undefined);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [atCap, setAtCap] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!membershipLoading && !isLeader && user) {
      router.replace(`/groups/${gid}`);
    }
  }, [isLeader, membershipLoading, user, gid, router]);

  const review = async (req: PendingRequest, action: "approve" | "reject") => {
    if (!user) return;
    setPending(req.uid);
    setActionError(null);
    setAtCap(false);
    try {
      await apiPost(`/api/groups/${gid}/join-requests/${req.uid}/${action}`, {});
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "group_at_cap") {
        setAtCap(true);
      } else {
        setActionError(
          e instanceof ApiError ? e.message || `HTTP ${e.status}` : "Something went wrong",
        );
      }
    } finally {
      setPending(null);
    }
  };

  if (authLoading || membershipLoading) {
    return <p className="p-4 text-sm text-cream-muted">Loading…</p>;
  }
  if (!user || !isLeader) return null;

  const requests =
    state.status === "ok"
      ? state.requests.filter(
          (r: PendingRequest) =>
            r.status === "pending" || r.status === "pending_leader",
        )
      : [];

  const memberCapReached =
    !!group?.memberCap && group.memberCount >= group.memberCap;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">
          {group?.name ?? "Group"} — join requests
        </h1>
        <Link href={`/groups/${gid}`} className="text-sm text-gold hover:underline">
          Back
        </Link>
      </div>

      {(atCap || memberCapReached) && (
        <p
          role="alert"
          data-testid="at-cap-error"
          className="mb-4 rounded bg-terracotta/10 p-3 text-sm text-terracotta"
        >
          This group is at its member limit ({group?.memberCount}
          {group?.memberCap ? ` / ${group.memberCap}` : ""}). Remove a member,
          or raise the cap in group settings, before approving new requests.
        </p>
      )}

      {actionError && (
        <p role="alert" className="mb-4 rounded bg-terracotta/10 p-3 text-sm text-terracotta">
          {actionError}
        </p>
      )}

      {state.status === "loading" && (
        <p className="text-sm text-cream-muted">Loading requests…</p>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-sm text-terracotta">
          {state.message}
        </p>
      )}

      {state.status === "ok" && requests.length === 0 && (
        <div
          data-testid="empty-state"
          className="rounded border border-dashed border-line py-12 text-center"
        >
          <p className="text-cream-muted">No pending join requests.</p>
        </div>
      )}

      {state.status === "ok" && requests.length > 0 && (
        <ul className="divide-y divide-line rounded border border-line">
          {requests.map((req: PendingRequest) => (
            <li
              key={req.uid}
              data-testid="join-request-row"
              className="flex items-start justify-between gap-4 px-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                {req.photoURL ? (
                  <Image
                    src={req.photoURL}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-raised text-sm font-medium text-cream-muted"
                  >
                    {req.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{req.displayName}</p>
                  {req.message && (
                    <p className="mt-0.5 text-xs text-cream-muted">&ldquo;{req.message}&rdquo;</p>
                  )}
                  <p className="mt-0.5 text-xs text-cream-muted">
                    {new Date(req.requestedAt).toLocaleDateString()}
                  </p>
                  {req.status === "pending_leader" && (
                    <p
                      data-testid={`minor-note-${req.uid}`}
                      className="mt-1 rounded bg-gold/10 px-2 py-1 text-xs text-gold"
                    >
                      Minor — your approval forwards to the owner for final
                      review.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid={`approve-${req.uid}`}
                  onClick={() => void review(req, "approve")}
                  disabled={pending !== null}
                >
                  {req.status === "pending_leader" ? "Vouch & forward" : "Approve"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`reject-${req.uid}`}
                  onClick={() => void review(req, "reject")}
                  disabled={pending !== null}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
