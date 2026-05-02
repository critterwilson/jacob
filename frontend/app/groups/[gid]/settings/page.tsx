"use client";

import Link from "next/link";
import { doc, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { GroupArchiveDialog } from "@/components/groups/GroupArchiveDialog";
import { GroupAvatarUpload } from "@/components/groups/GroupAvatarUpload";
import { GroupSettingsForm } from "@/components/groups/GroupSettingsForm";
import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";
import { useGroup } from "@/lib/hooks/useGroup";

type Props = { params: { gid: string } };

export default function GroupSettingsPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { group, loading: groupLoading } = useGroup(gid);
  const [isLeader, setIsLeader] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  // Check membership role via real-time listener.
  useEffect(() => {
    if (!user || !gid) {
      setMembershipLoading(false);
      return;
    }
    return onSnapshot(
      doc(firestore, "groups", gid, "members", user.uid),
      (snap) => {
        setIsLeader(snap.exists() && snap.data()?.role === "leader");
        setMembershipLoading(false);
      },
      () => setMembershipLoading(false),
    );
  }, [user, gid]);

  if (authLoading || groupLoading || membershipLoading) {
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

  if (!isLeader) {
    router.replace(`/groups/${gid}`);
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Group settings</h1>
        <Link href={`/groups/${gid}`} className="text-sm text-blue-600 hover:underline">
          ← Back to group
        </Link>
      </div>

      <section className="mb-8 rounded border border-gray-200 p-4">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Avatar</h2>
        <GroupAvatarUpload gid={gid} currentAvatarUrl={group.avatarUrl} />
      </section>

      <section className="mb-8 rounded border border-gray-200 p-4">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Metadata</h2>
        <GroupSettingsForm gid={gid} group={group} />
      </section>

      <section className="rounded border border-red-200 p-4">
        <h2 className="mb-3 text-sm font-semibold text-red-700">Danger zone</h2>
        {group.archivedAt ? (
          <p className="mb-3 text-sm text-gray-600">
            This group is archived. You can unarchive it to resume messaging.
          </p>
        ) : (
          <p className="mb-3 text-sm text-gray-600">
            Archiving makes this group read-only for everyone. Members can still view old
            messages. You can unarchive within 60 days.
          </p>
        )}
        <GroupArchiveDialog
          gid={gid}
          isArchived={Boolean(group.archivedAt)}
        />
      </section>
    </main>
  );
}
