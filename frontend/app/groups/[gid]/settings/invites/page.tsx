"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { InviteForm } from "@/components/groups/InviteForm";
import { InviteList } from "@/components/groups/InviteList";
import { useAuth } from "@/lib/auth-context";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useInvites } from "@/lib/hooks/useInvites";

type Props = { params: { gid: string } };

export default function GroupInvitesPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { isLeader, loading: membershipLoading } = useGroupMembership(
    user?.uid,
    gid,
  );
  const { invites, loading: invitesLoading } = useInvites(gid);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading || membershipLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  if (!isLeader) {
    router.replace(`/groups/${gid}`);
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Manage invites</h1>
        <Link
          href={`/groups/${gid}/settings`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to settings
        </Link>
      </div>

      <section className="mb-8 rounded border border-gray-200 p-4">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Create invite</h2>
        <InviteForm gid={gid} />
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Invite history</h2>
        {invitesLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <InviteList gid={gid} invites={invites} />
        )}
      </section>
    </main>
  );
}
