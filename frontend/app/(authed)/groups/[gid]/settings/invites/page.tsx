"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { InviteForm } from "@/components/groups/InviteForm";
import { InviteList } from "@/components/groups/InviteList";
import { Heading, Link, Section } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
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
  const { group } = useGroup(gid);
  const { invites, loading: invitesLoading } = useInvites(gid);
  const groupName = group?.name ?? "";

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading || membershipLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  if (!isLeader) {
    router.replace(`/groups/${gid}`);
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <Heading level={1} size="md">
          Manage invites
        </Heading>
        <Link
          href={`/groups/${gid}/settings`}
          variant="muted"
          className="text-body-sm"
        >
          ← Back to settings
        </Link>
      </header>

      <Section
        title="Create invite"
        description="Generate a shareable link with optional expiry and use limits."
      >
        <InviteForm gid={gid} groupName={groupName} />
      </Section>

      <Section
        title="Invite history"
        description="Active and past invites for this group."
      >
        {invitesLoading ? (
          <p className="text-body-sm text-cream-muted">Loading…</p>
        ) : (
          <InviteList gid={gid} groupName={groupName} invites={invites} />
        )}
      </Section>
    </main>
  );
}
