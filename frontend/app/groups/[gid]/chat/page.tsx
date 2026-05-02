"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";
import { useGroupMessages } from "@/lib/hooks/useGroupMessages";
import type { Message } from "@/lib/hooks/useGroupMessages";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ThreadPanel } from "@/components/chat/ThreadPanel";
import { ArchivedBanner } from "@/components/groups/ArchivedBanner";
import type { Timestamp } from "firebase/firestore";

type Props = { params: { gid: string } };

export default function ChatPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const { messages, loading, loadingOlder, hasMore, loadOlder } =
    useGroupMessages(user ? gid : undefined);

  const [groupName, setGroupName] = useState<string | null>(null);
  const [archivedAt, setArchivedAt] = useState<Timestamp | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [activeThread, setActiveThread] = useState<Message | null>(null);

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

  // Watch group doc for name and archival state.
  useEffect(() => {
    if (!gid) return;
    return onSnapshot(
      doc(firestore, "groups", gid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setGroupName(data.name as string);
          setArchivedAt((data.archivedAt as Timestamp | null) ?? null);
        } else {
          setGroupName(null);
          setArchivedAt(null);
        }
      },
      () => {},
    );
  }, [gid]);

  // Keep activeThread in sync with live message data so threadReplyCount and
  // participants stay fresh while the panel is open.
  useEffect(() => {
    if (!activeThread) return;
    const updated = messages.find((m: Message) => m.id === activeThread.id);
    if (updated) setActiveThread(updated);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

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

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {archivedAt && (
            <ArchivedBanner />
          )}
          <MessageList
            gid={gid}
            messages={messages}
            loading={loading}
            loadingOlder={loadingOlder}
            hasMore={hasMore}
            isLeader={isLeader}
            onLoadOlder={() => void loadOlder()}
            onReply={setActiveThread}
          />
          <MessageInput gid={gid} archived={archivedAt != null} />
        </div>

        {activeThread && (
          <ThreadPanel
            gid={gid}
            parentMessage={activeThread}
            isLeader={isLeader}
            currentUserUid={user.uid}
            onClose={() => setActiveThread(null)}
          />
        )}
      </div>
    </main>
  );
}
