"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { MessageList } from "@/components/chat/MessageList";
import { JoinRequestButton } from "@/components/discover/JoinRequestButton";
import { useAuth } from "@/lib/auth-context";
import { useGroup } from "@/lib/hooks/useGroup";
import { useGroupMessages } from "@/lib/hooks/useGroupMessages";

type Props = { params: { gid: string } };

export default function ReadOnlyGroupPage({ params }: Props) {
  const { gid } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { group, loading: groupLoading } = useGroup(gid);
  const { messages, loading: msgLoading, loadingOlder, hasMore, loadOlder } = useGroupMessages(gid);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  // Redirect to member chat if user is actually a member.
  useEffect(() => {
    if (!groupLoading && group && user) {
      // We don't know member status from the group doc alone; let Firestore
      // rules deny thread reads if needed. The member chat page handles
      // redirect once membership is confirmed.
    }
  }, [groupLoading, group, user]);

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
        <p className="text-cream-muted">Group not found or private.</p>
        <Link href="/discover" className="mt-4 inline-block text-sm text-gold hover:underline">
          ← Back to discover
        </Link>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div>
          <Link href="/discover" className="text-xs text-cream-muted hover:underline">
            ← Discover
          </Link>
          <h1 className="mt-0.5 text-base font-semibold">{group.name}</h1>
          <p className="text-xs text-cream-muted">
            Read-only ·{" "}
            <span className="font-medium text-gold">
              {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
            </span>
          </p>
        </div>
        <JoinRequestButton
          gid={gid}
          joinMode={group.joinMode === "request" ? "request" : "open"}
        />
      </header>

      {/* Read-only notice */}
      <div className="shrink-0 border-b border-parchment-amber/30 bg-parchment-amber/15 px-4 py-2 text-xs text-parchment-amber">
        You&apos;re viewing this group in read-only mode. Join to participate.
      </div>

      {/* Feed — readonly so no input, picker, reply, edit, delete */}
      <div className="min-h-0 flex-1">
        <MessageList
          gid={gid}
          messages={messages}
          loading={msgLoading}
          loadingOlder={loadingOlder}
          hasMore={hasMore}
          isLeader={false}
          archived={false}
          onLoadOlder={loadOlder}
          readonly
        />
      </div>
    </main>
  );
}
