"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { GroupArchiveDialog } from "@/components/groups/GroupArchiveDialog";
import { GroupAvatarUpload } from "@/components/groups/GroupAvatarUpload";
import { GroupMemberCapForm } from "@/components/groups/GroupMemberCapForm";
import { GroupSettingsForm } from "@/components/groups/GroupSettingsForm";
import { Heading, Link, Section } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";

type Props = { params: { gid: string } };

export default function GroupSettingsPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { group, loading: groupLoading } = useGroup(gid);
  const { isLeader, loading: membershipLoading } = useGroupMembership(
    user?.uid,
    gid,
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  if (authLoading || groupLoading || membershipLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  if (!group) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 space-y-4">
        <p className="text-body-sm text-cream-muted">Group not found.</p>
        <Link href="/groups" variant="muted" className="text-body-sm">
          ← Back to groups
        </Link>
      </main>
    );
  }

  if (!isLeader) {
    router.replace(`/groups/${gid}`);
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <Heading level={1} size="md">
          Group settings
        </Heading>
        <Link
          href={`/groups/${gid}`}
          variant="muted"
          className="text-body-sm"
        >
          ← Back to group
        </Link>
      </header>

      <Section title="Avatar" description="The image members see beside the group name.">
        <GroupAvatarUpload gid={gid} currentAvatarUrl={group.avatarUrl} />
      </Section>

      <Section title="Metadata" description="Name, description, and visibility for the group.">
        <GroupSettingsForm gid={gid} group={group} />
      </Section>

      <Section
        title="Member cap"
        description="The maximum number of members allowed in this group. The default is 20. Raise this if your group needs to grow beyond that."
      >
        <GroupMemberCapForm
          gid={gid}
          currentCap={group.memberCap ?? null}
          memberCount={group.memberCount}
        />
      </Section>

      <Section
        tone="danger"
        title="Danger zone"
        description={
          group.archivedAt
            ? "This group is archived. You can unarchive it to resume messaging."
            : "Archiving makes this group read-only for everyone. Members can still view old messages. You can unarchive within 60 days."
        }
      >
        <GroupArchiveDialog gid={gid} isArchived={Boolean(group.archivedAt)} />
      </Section>
    </main>
  );
}
