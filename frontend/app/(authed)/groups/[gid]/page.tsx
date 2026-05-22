"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, ButtonLink } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useJoinRequests } from "@/lib/hooks/useJoinRequests";
import { ReportButton } from "@/components/moderation/ReportButton";

type Props = { params: { gid: string } };

// Visual classes shared by every section-nav tile inside a group.
// Pulled out so the member strip and the leader "Manage" row look
// identical and we never accidentally style them differently.
const tileClass =
  "block rounded border border-line bg-ink-raised px-3 py-2 text-sm text-cream no-underline transition-colors duration-fast hover:bg-ink-overlay";

export default function GroupPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { group, loading: groupLoading } = useGroup(gid);

  // `useGroupMembership` reads the canonical members/{uid} row, so
  // promoted leaders (not just the founder) get the leader-only UI.
  // The previous `createdBy === user.uid` heuristic missed them.
  const { isLeader } = useGroupMembership(user?.uid, gid);
  const { pendingCount } = useJoinRequests(isLeader ? gid : undefined);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [currentCode, setCurrentCode] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (group) {
      setCurrentCode(group.inviteCode);
    }
  }, [group]);

  const handleRotate = async () => {
    if (!user) return;
    setRotateError(null);
    setRotating(true);
    try {
      const { inviteCode } = await apiPost<{ inviteCode: string }>(
        `/api/groups/${gid}/invite/rotate`,
        undefined,
      );
      setCurrentCode(inviteCode);
    } catch (e) {
      setRotateError(
        e instanceof ApiError
          ? e.message || "Failed to rotate code."
          : "Something went wrong.",
      );
    } finally {
      setRotating(false);
    }
  };

  if (authLoading || groupLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  if (!group) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-cream-muted">Group not found.</p>
        <Link href="/groups" className="mt-4 inline-block text-sm text-gold hover:underline">
          Back to groups
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-2 flex items-start justify-between">
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <div className="flex items-center gap-3">
          <ReportButton
            resourceType="group"
            resourceId={gid}
            groupId={gid}
            className="text-xs text-cream-muted hover:text-cream-muted"
          />
          <Link href="/groups" className="text-sm text-gold hover:underline">
            All groups
          </Link>
        </div>
      </div>

      {group.description && (
        <p className="mb-4 text-cream-muted">{group.description}</p>
      )}

      <p className="mb-6 text-sm text-cream-muted">
        {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
        {group.isPrivate && " · Private"}
      </p>

      <ButtonLink
        href={`/groups/${gid}/chat`}
        variant="primary"
        className="mb-6"
      >
        Open chat
      </ButtonLink>

      {/* Member sub-nav — the three sections every member of this group
       *  can use. Visually distinct from the leader "Manage" row below
       *  so non-leaders see exactly one nav block and leaders can tell
       *  at a glance which tools are theirs. */}
      <nav aria-label="Group sections" className="mt-2">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <li>
            <Link href={`/groups/${gid}/devotionals`} className={tileClass}>
              Devotionals
            </Link>
          </li>
          <li>
            <Link href={`/groups/${gid}/sermons`} className={tileClass}>
              Sermons
            </Link>
          </li>
          <li>
            <Link href={`/groups/${gid}/events`} className={tileClass}>
              Events
            </Link>
          </li>
          <li>
            <Link href={`/groups/${gid}/members`} className={tileClass}>
              Members
            </Link>
          </li>
        </ul>
      </nav>

      {isLeader && (
        // Leader-only "Manage group" block. Pulled out from the member
        // sub-nav grid (where it used to live as four extra grid items)
        // because mixing member-tabs with leader-tools made it hard for
        // a leader to spot their admin actions. Invites also moves up
        // one level here from /settings/invites so rotating an invite
        // is 4 clicks from /home rather than 5.
        <section
          className="mt-6 rounded border border-line bg-ink-raised/40 p-3"
          aria-labelledby="group-manage-heading"
        >
          <h2
            id="group-manage-heading"
            className="mb-2 px-1 text-eyebrow uppercase tracking-wider text-cream-muted"
          >
            Manage group
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <li>
              <Link
                href={`/groups/${gid}/join-requests`}
                className={`relative ${tileClass}`}
              >
                Join requests
                {pendingCount > 0 && (
                  <span
                    aria-label={`${pendingCount} pending`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-terracotta px-1 text-[10px] font-semibold text-white"
                  >
                    {pendingCount}
                  </span>
                )}
              </Link>
            </li>
            <li>
              <Link href={`/groups/${gid}/settings`} className={tileClass}>
                Settings
              </Link>
            </li>
            <li>
              <Link
                href={`/groups/${gid}/settings/invites`}
                className={tileClass}
              >
                Invites
              </Link>
            </li>
            <li>
              <Link href={`/groups/${gid}/analytics`} className={tileClass}>
                Analytics
              </Link>
            </li>
          </ul>
        </section>
      )}

      {isLeader && (
        <section className="mt-8 rounded border border-line p-4">
          <h2 className="mb-3 text-sm font-semibold text-cream-muted">Invite code</h2>
          <p className="mb-3 font-mono text-lg tracking-widest">{currentCode}</p>
          <p className="mb-3 text-sm text-cream-muted">
            Share this code with people you want to invite. They can join at{" "}
            <span className="font-mono text-xs">/join?code={currentCode}</span>.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleRotate()}
            loading={rotating}
            disabled={rotating}
          >
            {rotating ? "Rotating…" : "Generate new code"}
          </Button>
          {rotateError && (
            <p role="alert" className="mt-2 text-sm text-terracotta">
              {rotateError}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
