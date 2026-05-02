"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";
import { useGroup } from "@/lib/hooks/useGroup";
import { GroupSettingsForm } from "@/components/groups/GroupSettingsForm";
import { GroupAvatarUpload } from "@/components/groups/GroupAvatarUpload";
import { GroupArchiveDialog } from "@/components/groups/GroupArchiveDialog";

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

  // Watch membership doc for leader status.
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

  // Redirect non-leaders away from settings.
  useEffect(() => {
    if (!membershipLoading && !isLeader) {
      router.replace(`/groups/${gid}`);
    }
  }, [membershipLoading, isLeader, gid, router]);

  if (authLoading || groupLoading || membershipLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </main>
    );
  }

  if (!user || !isLeader) return null;

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
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/groups/${gid}`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← {group.name}
        </Link>
        <h1 className="text-xl font-semibold">Group settings</h1>
      </div>

      {/* Metadata */}
      <section className="mb-8 rounded border border-gray-200 p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Metadata</h2>
        <GroupSettingsForm
          gid={gid}
          initialValues={{
            name: group.name,
            description: group.description,
            isPrivate: group.isPrivate,
          }}
        />
      </section>

      {/* Avatar */}
      <section className="mb-8 rounded border border-gray-200 p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Group avatar</h2>
        <GroupAvatarUpload
          gid={gid}
          currentAvatarUrl={group.avatarUrl ?? null}
        />
      </section>

      {/* Danger zone */}
      <section className="rounded border border-red-200 p-5">
        <h2 className="mb-2 text-sm font-semibold text-red-700">Danger zone</h2>
        <p className="mb-4 text-sm text-gray-600">
          {group.archivedAt
            ? "This group is archived. Unarchiving re-enables messages for all members."
            : "Archiving disables new messages. Content stays visible. Reversible within 60 days."}
        </p>
        <GroupArchiveDialog
          gid={gid}
          isArchived={group.archivedAt != null}
        />
      </section>
    </main>
  );
}
