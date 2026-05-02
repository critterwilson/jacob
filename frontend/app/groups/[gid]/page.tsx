"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { ReportLink } from "@/components/moderation/ReportLink";

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
      const token = await user.getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/groups/${gid}/invite/rotate`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setRotateError(err?.error?.message ?? "Failed to rotate code.");
        return;
      }
      const { inviteCode } = (await res.json()) as { inviteCode: string };
      setCurrentCode(inviteCode);
    } catch {
      setRotateError("Something went wrong.");
    } finally {
      setRotating(false);
    }
  };

  if (authLoading || groupLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  if (!group) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-gray-500">Group not found.</p>
        <Link href="/groups" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
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
          <ReportLink
            contentType="group"
            groupId={gid}
            className="text-xs text-gray-400 hover:text-gray-600"
          />
          <Link href="/groups" className="text-sm text-blue-600 hover:underline">
            All groups
          </Link>
        </div>
      </div>

      {group.description && (
        <p className="mb-4 text-gray-600">{group.description}</p>
      )}

      <p className="mb-6 text-sm text-gray-500">
        {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
        {group.isPrivate && " · Private"}
      </p>

      <Link
        href={`/groups/${gid}/chat`}
        className="mb-6 inline-block rounded bg-blue-600 px-4 py-2 font-medium text-white"
      >
        Open chat
      </Link>

      {isLeader && (
        <section className="mt-8 rounded border border-gray-200 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Invite code</h2>
          <p className="mb-3 font-mono text-lg tracking-widest">{currentCode}</p>
          <p className="mb-3 text-sm text-gray-500">
            Share this code with people you want to invite. They can join at{" "}
            <span className="font-mono text-xs">/join?code={currentCode}</span>.
          </p>
          <button
            type="button"
            onClick={() => void handleRotate()}
            disabled={rotating}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {rotating ? "Rotating…" : "Generate new code"}
          </button>
          {rotateError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {rotateError}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
