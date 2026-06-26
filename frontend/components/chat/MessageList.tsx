"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MessageItem } from "@/components/chat/MessageItem";
import { BranchMark } from "@/components/motifs/BranchMark";
import {
  MessageMenuProvider,
  useMessageMenu,
} from "@/components/chat/MessageMenuContext";
import { Banner } from "@/components/ui";
import { useBlocks } from "@/lib/hooks/useBlocks";
import { useMembers } from "@/lib/hooks/useMembers";
import { useMutes } from "@/lib/hooks/useMutes";
import { useReactions } from "@/lib/hooks/useReactions";
import type { Message } from "@/lib/hooks/useGroupMessages";

type Props = {
  gid: string;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  isLeader: boolean;
  archived?: boolean;
  offline?: boolean;
  onLoadOlder: () => void;
  onReply?: (message: Message) => void;
  pinnedIds?: string[];
  onTogglePin?: (mid: string) => void;
  onAnnounce?: (mid: string) => void;
  readonly?: boolean;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 120;

const createdAtMs = (m: Message): number =>
  m.createdAt ? Date.parse(m.createdAt) || 0 : 0;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDayDivider(ms: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ms);
  const oneDay = 24 * 60 * 60 * 1000;
  if (day === today) return "Today";
  if (day === today - oneDay) return "Yesterday";
  const d = new Date(ms);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function DayDivider({ label }: { label: string }) {
  return (
    <div
      role="separator"
      aria-label={label}
      className="sticky top-0 z-[5] flex items-center justify-center px-4 py-2"
    >
      <span className="rounded-full bg-ink-overlay/90 px-3 py-1 text-caption font-medium text-cream-muted shadow-pop backdrop-blur-sm">
        {label}
      </span>
    </div>
  );
}

function JumpToBottomIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  );
}

/**
 * Renders a list of messages. T21:
 *   - Blocked users' messages are hidden entirely.
 *   - Muted users' messages are collapsed to a "Muted user · Show" stub
 *     until the viewer expands them in the current session.
 *   - The author always sees their own messages regardless.
 *
 * Mobile UX:
 *   - Consecutive messages from the same author within 5 minutes are
 *     grouped: the continuation rows hide avatar + author name to
 *     tighten vertical rhythm and reduce noise.
 *   - A sticky day divider ("Today", "Yesterday", date) anchors the
 *     reader when scrolling through history.
 *   - First load lands instantly at the bottom (no smooth-scroll jank
 *     from the top); subsequent message arrivals smooth-scroll only
 *     when the user is already near the bottom.
 *   - A floating "jump to bottom" pill appears when the user is
 *     scrolled up and a new message arrives off-screen.
 */
export function MessageList(props: Props) {
  // Wrap the inner list in `MessageMenuProvider` so every MessageItem
  // shares a single open-menu state — opening one message's reaction
  // picker or More menu closes any other open menu, outside-tap and Esc
  // dismiss, and the scroll dismissal below stays consistent with that.
  return (
    <MessageMenuProvider>
      <MessageListInner {...props} />
    </MessageMenuProvider>
  );
}

function MessageListInner({
  gid,
  messages,
  loading,
  loadingOlder,
  hasMore,
  isLeader,
  archived = false,
  offline = false,
  onLoadOlder,
  onReply,
  pinnedIds,
  onTogglePin,
  onAnnounce,
  readonly = false,
}: Props) {
  const { close: closeMenu } = useMessageMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);
  const prevCountRef = useRef(0);
  const lastIdRef = useRef<string | null>(null);
  const { isMuted } = useMutes();
  const { isBlocked } = useBlocks();
  const { members } = useMembers(gid);
  const {
    isMyReaction,
    toggle: toggleReaction,
    mergeReactionCounts,
  } = useReactions(gid, messages);
  const [expandedMutes, setExpandedMutes] = useState<Set<string>>(new Set());
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);

  // Hide blocked-author messages entirely. They never render.
  const visible = messages.filter((m) => !isBlocked(m.authorUid));
  const lastVisibleId = visible.length > 0 ? visible[visible.length - 1].id : null;

  // Initial paint: jump straight to the bottom *without* smooth-scroll
  // so the user lands on the latest message instantly. Runs once per
  // mount, after the first non-empty render.
  useLayoutEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (loading) return;
    if (visible.length === 0) return;
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    initialScrollDoneRef.current = true;
    prevCountRef.current = visible.length;
    lastIdRef.current = lastVisibleId;
  }, [loading, visible.length, lastVisibleId]);

  // Subsequent updates: smooth-scroll only if the user is already near
  // the bottom — otherwise show the jump-to-bottom pill so we don't
  // yank them away from older history they're reading.
  useEffect(() => {
    if (!initialScrollDoneRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const grew = visible.length > prevCountRef.current;
    const lastChanged = lastVisibleId !== null && lastIdRef.current !== lastVisibleId;
    prevCountRef.current = visible.length;
    lastIdRef.current = lastVisibleId;
    if (!grew && !lastChanged) return;
    const distanceFromBottom =
      container.scrollHeight - (container.scrollTop + container.clientHeight);
    if (distanceFromBottom <= NEAR_BOTTOM_PX) {
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
      setUnreadBelow(0);
    } else {
      setUnreadBelow((n) => n + 1);
      setShowJumpToBottom(true);
    }
  }, [visible.length, lastVisibleId]);

  // Toggle the jump-to-bottom pill on user scroll so it disappears
  // once they're back near the bottom. Also closes any open message
  // menu — a previous bug let the action pill / reaction picker stay
  // pinned to a row even as the user scrolled it off-screen, hiding
  // messages underneath.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      closeMenu();
      const distanceFromBottom =
        container.scrollHeight - (container.scrollTop + container.clientHeight);
      if (distanceFromBottom <= NEAR_BOTTOM_PX) {
        setShowJumpToBottom(false);
        setUnreadBelow(0);
      } else if (unreadBelow > 0) {
        setShowJumpToBottom(true);
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [unreadBelow, closeMenu]);

  const jumpToBottom = () => {
    const container = scrollRef.current;
    if (!container) return;
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else {
      container.scrollTop = container.scrollHeight;
    }
    setShowJumpToBottom(false);
    setUnreadBelow(0);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-body-sm text-cream-muted">Loading messages…</span>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-momentum bg-ink"
      >
        {offline && (
          <Banner
            tone="warning"
            role="status"
            className="sticky top-0 z-10 rounded-none border-x-0 border-t-0"
          >
            Offline — showing your last loaded messages.
          </Banner>
        )}
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className={
                "rounded-full border border-line bg-ink-raised px-3 py-1 text-caption text-cream-muted " +
                "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
                "focus:outline-none focus-visible:shadow-glow-gold disabled:opacity-50"
              }
            >
              {loadingOlder ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}

        {visible.length === 0 && (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <BranchMark className="h-12 opacity-80" />
            <p className="max-w-xs text-body-sm text-cream-muted">
              It&apos;s quiet here for now. Share something to get it growing.
            </p>
          </div>
        )}

        {/*
          T62 — `role="log"` + `aria-live="polite"` lets a screen reader
          announce new messages without interrupting the user. We rely
          on the default `aria-relevant="additions"` so deletes/edits
          don't re-trigger announcements.
        */}
        <div
          className="flex flex-col pb-2"
          role="log"
          aria-live="polite"
          aria-label="Group chat message log"
        >
          {visible.map((msg, idx) => {
            const muted = isMuted(msg.authorUid) && !expandedMutes.has(msg.id);
            if (muted) {
              return (
                <div
                  key={msg.id}
                  className="flex items-center gap-2 px-4 py-2 text-caption italic text-cream-muted transition-colors duration-fast hover:bg-ink-raised"
                >
                  <span>Muted user</span>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedMutes((prev) => new Set(prev).add(msg.id))
                    }
                    className="rounded-sm text-gold-soft hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
                  >
                    Show
                  </button>
                </div>
              );
            }

            const prev = idx > 0 ? visible[idx - 1] : null;
            const prevVisibleMuted =
              prev != null && isMuted(prev.authorUid) && !expandedMutes.has(prev.id);
            const thisMs = createdAtMs(msg);
            const prevMs = prev ? createdAtMs(prev) : 0;
            const sameDay =
              prev != null && startOfDay(thisMs) === startOfDay(prevMs);
            const showDayDivider = !prev || !sameDay;
            // Continuation: same author, same day, within 5 min,
            // and the previous row actually rendered (not a muted
            // collapse). Threads (parentMessageId != null) stand alone.
            const isContinuation =
              !showDayDivider &&
              !prevVisibleMuted &&
              prev != null &&
              prev.authorUid === msg.authorUid &&
              !prev.deletedAt &&
              !msg.deletedAt &&
              msg.parentMessageId === null &&
              prev.parentMessageId === null &&
              thisMs - prevMs < FIVE_MINUTES_MS;

            return (
              <Fragment key={msg.id}>
                {showDayDivider && thisMs > 0 && (
                  <DayDivider label={formatDayDivider(thisMs)} />
                )}
                <MessageItem
                  gid={gid}
                  message={msg}
                  isLeader={isLeader}
                  onReply={readonly ? undefined : onReply}
                  pinnedIds={pinnedIds}
                  onTogglePin={readonly ? undefined : onTogglePin}
                  onAnnounce={readonly ? undefined : onAnnounce}
                  members={members}
                  archived={archived}
                  isMyReaction={readonly ? undefined : isMyReaction}
                  onToggleReaction={
                    readonly
                      ? undefined
                      : (mid, slug) => void toggleReaction(mid, slug)
                  }
                  mergeReactionCounts={readonly ? undefined : mergeReactionCounts}
                  readonly={readonly}
                  isContinuation={isContinuation}
                />
              </Fragment>
            );
          })}
        </div>
      </div>

      {showJumpToBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          aria-label={
            unreadBelow > 0
              ? `${unreadBelow} new message${unreadBelow === 1 ? "" : "s"} below, jump to bottom`
              : "Jump to bottom"
          }
          className={
            "absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-line bg-ink-raised px-3 py-1.5 text-caption text-cream shadow-pop " +
            "transition-colors duration-fast hover:bg-ink-overlay " +
            "focus:outline-none focus-visible:shadow-glow-gold"
          }
        >
          {unreadBelow > 0 && (
            <span
              aria-hidden="true"
              className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[0.625rem] font-semibold text-ink"
            >
              {unreadBelow > 99 ? "99+" : unreadBelow}
            </span>
          )}
          <span aria-hidden="true">New</span>
          <JumpToBottomIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
