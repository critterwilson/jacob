"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";
import { useGroupMessages } from "@/lib/hooks/useGroupMessages";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";

type Props = { params: { gid: string } };

export default function ChatPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const { messages, loading, loadingOlder, hasMore, loadOlder } =
    useGroupMessages(user ? gid : undefined);

  const [groupName, setGroupName] = useState<string | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  // Watch current user's membership doc for leader status.
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

  // Watch group name for the header.
  useEffect(() => {
    if (!gid) return;
    return onSnapshot(
      doc(firestore, "groups", gid),
      (snap) => {
        setGroupName(snap.exists() ? (snap.data().name as string) : null);
      },
      () => {},
    );
  }, [gid]);

  if (authLoading || membershipLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 px-4 py-3">
        <Link
          href={`/groups/${gid}`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← {groupName ?? "Group"}
        </Link>
        <h1 className="text-sm font-semibold text-gray-900">Chat</h1>
      </header>

      <MessageList
        gid={gid}
        messages={messages}
        loading={loading}
        loadingOlder={loadingOlder}
        hasMore={hasMore}
        isLeader={isLeader}
        onLoadOlder={() => void loadOlder()}
      />

      <MessageInput gid={gid} />
    </main>
  );
}
