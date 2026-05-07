"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { ReportButton } from "@/components/moderation/ReportButton";

type Props = { params: { gid: string } };

export default function GroupPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { group, loading: groupLoading } = useGroup(gid);

  const [isLeader, setIsLeader] = useState(false);
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
      setIsLeader(group.createdBy === user?.uid);
    }
  }, [group, user?.uid]);

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
      <main className="flex min-h-screen items-center justify-center">
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
            className="text-xs text-cream-dim hover:text-cream-muted"
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

      <Link
        href={`/groups/${gid}/chat`}
        className="mb-6 inline-block rounded bg-gold px-4 py-2 font-medium text-ink"
      >
        Open chat
      </Link>

      {isLeader && (
        <section className="mt-8 rounded border border-line p-4">
          <h2 className="mb-3 text-sm font-semibold text-cream-muted">Invite code</h2>
          <p className="mb-3 font-mono text-lg tracking-widest">{currentCode}</p>
          <p className="mb-3 text-sm text-cream-muted">
            Share this code with people you want to invite. They can join at{" "}
            <span className="font-mono text-xs">/join?code={currentCode}</span>.
          </p>
          <button
            type="button"
            onClick={() => void handleRotate()}
            disabled={rotating}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-ink-raised disabled:opacity-50"
          >
            {rotating ? "Rotating…" : "Generate new code"}
          </button>
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
