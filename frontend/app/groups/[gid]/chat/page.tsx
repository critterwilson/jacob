"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useGroupMessages } from "@/lib/hooks/useGroupMessages";
import type { Message } from "@/lib/hooks/useGroupMessages";
import { usePinnedMessages } from "@/lib/hooks/usePinnedMessages";
import { useAnnounce } from "@/lib/hooks/useAnnounce";
import { ArchivedBanner } from "@/components/groups/ArchivedBanner";
import { PinnedBar } from "@/components/chat/PinnedBar";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ThreadPanel } from "@/components/chat/ThreadPanel";

type Props = { params: { gid: string } };

export default function ChatPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const { messages, loading, loadingOlder, hasMore, loadOlder, offline } =
    useGroupMessages(user ? gid : undefined);

  const { group } = useGroup(user ? gid : undefined);
  const { isLeader, loading: membershipLoading } = useGroupMembership(
    user?.uid,
    user ? gid : undefined,
  );
  const { pinnedIds, togglePin } = usePinnedMessages(gid);
  const { announce } = useAnnounce(gid);

  const [activeThread, setActiveThread] = useState<Message | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

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

  const groupName = group?.name ?? null;
  const archivedAt = group?.archivedAt ?? null;

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
          {archivedAt && <ArchivedBanner />}
          <PinnedBar gid={gid} isLeader={isLeader} />
          <MessageList
            gid={gid}
            messages={messages}
            loading={loading}
            loadingOlder={loadingOlder}
            hasMore={hasMore}
            isLeader={isLeader}
            archived={Boolean(archivedAt)}
            offline={offline}
            pinnedIds={pinnedIds}
            onLoadOlder={() => void loadOlder()}
            onReply={setActiveThread}
            onTogglePin={(mid) => void togglePin(mid)}
            onAnnounce={(mid) => void announce(mid)}
          />
          <MessageInput gid={gid} archived={Boolean(archivedAt)} />
        </div>

        {activeThread && (
          <ThreadPanel
            gid={gid}
            parentMessage={activeThread}
            isLeader={isLeader}
            currentUserUid={user.uid}
            archived={Boolean(archivedAt)}
            onClose={() => setActiveThread(null)}
          />
        )}
      </div>
    </main>
  );
}
