"use client";

import { type MouseEvent, useState } from "react";

import { ApiError, apiDelete, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { MessageBody } from "@/components/chat/MessageBody";
import { useMessageMenu } from "@/components/chat/MessageMenuContext";
import {
  MessageMoreMenu,
  type MoreMenuItem,
} from "@/components/chat/MessageMoreMenu";
import { PhotoView } from "@/components/chat/PhotoView";
import { ReactionBar } from "@/components/chat/ReactionBar";
import { ReactionPicker } from "@/components/chat/ReactionPicker";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { WellbeingFlagDialog } from "@/components/moderation/WellbeingFlagDialog";
import { StickerBadge } from "@/components/stickers/StickerBadge";
import { Avatar, Button, Textarea, cn } from "@/components/ui";
import { useStickers } from "@/lib/hooks/useStickers";
import type { Message } from "@/lib/hooks/useGroupMessages";
import type { Member as FullMember } from "@/lib/hooks/useMembers";

type Member = Pick<FullMember, "uid" | "displayName"> & {
  photoURL?: string | null;
};

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MEDIA_URL_PREFIX = "https://storage.googleapis.com/jacob-media-public-";

function isSafeMediaUrl(url: string): boolean {
  return url.startsWith(MEDIA_URL_PREFIX);
}

function resolveAuthor(
  authorUid: string,
  members: readonly Member[] | undefined,
  selfUid?: string,
): { displayName: string; photoURL?: string | null } {
  const m = members?.find((x) => x.uid === authorUid);
  if (authorUid === selfUid) {
    return { displayName: "You", photoURL: m?.photoURL ?? null };
  }
  return {
    displayName: m?.displayName ?? "Member",
    photoURL: m?.photoURL ?? null,
  };
}

type Props = {
  gid: string;
  message: Message;
  isLeader: boolean;
  onReply?: (message: Message) => void;
  currentUserUid?: string;
  pinnedIds?: string[];
  onTogglePin?: (mid: string) => void;
  onAnnounce?: (mid: string) => void;
  archived?: boolean;
  isMyReaction?: (mid: string, slug: string) => boolean;
  onToggleReaction?: (mid: string, slug: string) => void;
  /**
   * Optional adapter from the `useReactions` hook that turns a base
   * `reactionCounts` map into one with optimistic deltas applied — so
   * the chip count bumps locally on click instead of waiting for the
   * next 10s poll. When omitted, the raw `reactionCounts` from the
   * message is used as-is.
   */
  mergeReactionCounts?: (
    mid: string,
    base: Record<string, number> | undefined,
  ) => Record<string, number>;
  members?: Member[];
  readonly?: boolean;
  /**
   * When true, this message is a continuation of the previous message
   * from the same author within a short window. The avatar + author
   * name + top-line timestamp are hidden to tighten vertical rhythm
   * and reduce the "wall of avatars" feel on mobile. Computed by
   * MessageList; defaults to false so threaded uses (where every reply
   * stands alone) render unchanged.
   */
  isContinuation?: boolean;
};

export function MessageItem({
  gid,
  message,
  isLeader,
  onReply,
  currentUserUid,
  pinnedIds = [],
  onTogglePin,
  onAnnounce,
  archived = false,
  isMyReaction,
  onToggleReaction,
  mergeReactionCounts,
  members,
  readonly = false,
  isContinuation = false,
}: Props) {
  const { user } = useAuth();
  const resolvedUid = currentUserUid ?? user?.uid;
  const { stickers } = useStickers();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [wellbeingOpen, setWellbeingOpen] = useState(false);
  const menu = useMessageMenu();

  const isAuthor = resolvedUid === message.authorUid;
  const author = resolveAuthor(message.authorUid, members, resolvedUid);
  const hasParticipated =
    message.participants?.includes(resolvedUid ?? "") ?? false;
  const createdAtMs = message.createdAt
    ? Date.parse(message.createdAt) || 0
    : 0;
  const isDeleted = message.deletedAt != null;
  const canEdit =
    isAuthor && !isDeleted && Date.now() - createdAtMs < FIFTEEN_MIN_MS;
  const canDelete = (isAuthor || isLeader) && !isDeleted;

  // T20 — auto-moderation hidden state. The author always sees their own
  // message; everyone else sees a placeholder with a "Show anyway" toggle.
  // The toggle is per-user and client-only — Firestore is unchanged.
  const isAutoHidden = message.moderation?.state === "hidden";
  const [showHidden, setShowHidden] = useState(false);
  const shouldHideBody = isAutoHidden && !isAuthor && !showHidden;

  const messageStickers = stickers.filter((s) =>
    message.stickerIds.includes(s.slug),
  );

  const timestamp = message.createdAt
    ? new Date(createdAtMs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const handleEdit = async () => {
    const trimmed = editBody.trim();
    if (!trimmed || trimmed === message.body) {
      setEditing(false);
      setEditBody(message.body);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/groups/${gid}/messages/${message.id}`, {
        body: trimmed,
      });
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "edit_window_expired") {
          setError("Edit window expired (15 minutes).");
        } else {
          setError("Failed to save edit.");
        }
      } else {
        setError("Failed to save edit.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await apiDelete(`/api/groups/${gid}/messages/${message.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code !== "aborted") {
        setError("Failed to delete message.");
      } else {
        setError("Failed to delete message.");
      }
    }
  };

  // Touch devices have no hover state — the action row would be unreachable
  // if we only revealed it on `:hover`. Tapping the message toggles the
  // shared `MessageMenuContext` for `(mid, "actions")`; on desktop hover
  // continues to reveal the row via the `group-hover` class below. Only
  // one menu is ever open across the chat (see MessageMenuContext) — so
  // tapping another message, scrolling, tapping outside, or pressing Esc
  // all reliably dismiss it.
  const actionsActive = menu.isOpen(message.id, "actions");
  const anyMenuOpenForThis =
    menu.openMenu?.mid === message.id && menu.openMenu.type !== null;
  const handleSurfaceClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    // Don't toggle when the user is interacting with the actions row,
    // inline links, the edit textarea, photos, reaction chips, or stickers.
    if (
      target.closest("[data-message-menu]") ||
      target.closest("a") ||
      target.closest("button") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest("img")
    ) {
      return;
    }
    menu.toggle(message.id, "actions");
  };

  // Compose the More-menu items. Each is rendered only when applicable
  // so the popover stays short (Edit only on your own messages, Pin only
  // for leaders, Report/Flag only on other people's messages, etc.).
  const moreItems: MoreMenuItem[] = [];
  if (canEdit) {
    moreItems.push({
      key: "edit",
      label: "Edit",
      onSelect: () => setEditing(true),
    });
  }
  if (canDelete) {
    moreItems.push({
      key: "delete",
      label: "Delete",
      destructive: true,
      onSelect: () => void handleDelete(),
    });
  }
  if (isLeader && onTogglePin) {
    moreItems.push({
      key: "pin",
      label: pinnedIds.includes(message.id) ? "Unpin" : "Pin",
      onSelect: () => onTogglePin(message.id),
    });
  }
  if (isLeader && onAnnounce && !message.announcedAt) {
    moreItems.push({
      key: "announce",
      label: "Announce",
      onSelect: () => onAnnounce(message.id),
    });
  }
  if (!isAuthor && resolvedUid) {
    moreItems.push({
      key: "report",
      label: "Report",
      onSelect: () => setReportOpen(true),
    });
    moreItems.push({
      key: "flag",
      label: "Flag concern",
      onSelect: () => setWellbeingOpen(true),
    });
  }

  return (
    <article
      data-message-id={message.id}
      onClick={handleSurfaceClick}
      className={cn(
        "group relative flex gap-3 px-4 transition-colors duration-fast hover:bg-ink-raised",
        // Continuation: tight top padding for grouped rhythm. Lead
        // message in a group: normal top padding so the visual block
        // is clearly separated from the previous sender.
        isContinuation ? "pt-0.5 pb-1" : "pt-3 pb-1",
        anyMenuOpenForThis && "bg-ink-raised",
      )}
    >
      {isContinuation ? (
        // Reserve the avatar gutter so message bodies stay aligned
        // across the group. Hover surfaces the timestamp inline as a
        // gentle in-place breadcrumb for "when exactly was this?".
        <div
          aria-hidden="true"
          className="relative w-8 shrink-0 text-right text-caption text-cream-muted opacity-0 transition-opacity duration-fast group-hover:opacity-60"
        >
          <span className="absolute right-0 top-1 whitespace-nowrap">
            {timestamp}
          </span>
        </div>
      ) : (
        <Avatar
          name={author.displayName}
          photoURL={author.photoURL}
          size="sm"
          aria-hidden="true"
          className="mt-0.5"
        />
      )}

      <div className="min-w-0 flex-1 space-y-1">
        {!isContinuation && (
          <div className="flex items-baseline gap-2">
            <span className="text-body-sm font-semibold text-cream">
              {author.displayName}
            </span>
            <time className="text-caption text-cream-muted">{timestamp}</time>
            {message.editedAt && !isDeleted && (
              <span className="text-caption text-cream-muted">(edited)</span>
            )}
          </div>
        )}
        {isContinuation && message.editedAt && !isDeleted && (
          <span className="text-caption text-cream-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100">
            (edited)
          </span>
        )}

        {isDeleted ? (
          <p className="text-body-sm italic text-cream-muted">[message removed]</p>
        ) : shouldHideBody ? (
          <div className="flex items-center gap-2">
            <p className="text-body-sm italic text-parchment-amber">
              Hidden pending review
            </p>
            <button
              type="button"
              onClick={() => setShowHidden(true)}
              className="text-caption text-gold-soft hover:text-gold focus:outline-none focus-visible:shadow-glow-gold rounded-sm"
            >
              Show anyway
            </button>
          </div>
        ) : editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              label="Edit message"
              hideLabel
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              maxLength={4000}
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void handleEdit()}
                loading={saving}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setEditBody(message.body);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <MessageBody
            body={message.body}
            mentions={message.mentions ?? []}
            members={members ?? []}
            currentUserUid={resolvedUid}
          />
        )}

        {messageStickers.length > 0 && !isDeleted && !shouldHideBody && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {messageStickers.map((s) => (
              <StickerBadge key={s.slug} sticker={s} size="sm" />
            ))}
          </div>
        )}

        {!isDeleted && !shouldHideBody && message.mediaRefs.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-2" aria-label="Photos">
            {message.mediaRefs.filter(isSafeMediaUrl).map((url) => (
              <li key={url}>
                <PhotoView
                  src={url}
                  alt=""
                  className="max-h-64 w-full max-w-xs rounded-md border border-line"
                />
              </li>
            ))}
          </ul>
        )}

        {!isDeleted && !readonly && onToggleReaction && isMyReaction && (
          <ReactionBar
            mid={message.id}
            reactionCounts={
              mergeReactionCounts
                ? mergeReactionCounts(message.id, message.reactionCounts)
                : message.reactionCounts
            }
            isMyReaction={isMyReaction}
            onToggle={onToggleReaction}
          />
        )}

        {!isDeleted && readonly && message.reactionCounts && (
          <ReactionBar
            mid={message.id}
            reactionCounts={message.reactionCounts}
            isMyReaction={() => false}
            onToggle={() => undefined}
          />
        )}

        {error && (
          <p role="alert" className="text-caption text-terracotta">
            {error}
          </p>
        )}

        {!isDeleted &&
          message.parentMessageId === null &&
          message.threadReplyCount > 0 && (
            <button
              type="button"
              onClick={() => onReply?.(message)}
              aria-label={`${message.threadReplyCount} ${
                message.threadReplyCount === 1 ? "reply" : "replies"
              }, open thread`}
              className="flex items-center gap-1 self-start rounded-sm text-caption text-gold-soft hover:text-gold focus:outline-none focus-visible:shadow-glow-gold"
            >
              {hasParticipated && (
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-gold"
                />
              )}
              {message.threadReplyCount}{" "}
              {message.threadReplyCount === 1 ? "reply" : "replies"}
            </button>
          )}
      </div>

      {!isDeleted && !editing && !readonly && (
        <div
          data-message-menu
          className={cn(
            "absolute right-2 top-0 z-10 flex items-center gap-0.5 rounded-full border border-line bg-ink-raised/95 px-1 py-1 shadow-pop backdrop-blur-sm transition-opacity duration-fast",
            // Lifted slightly above the message so the cluster reads as
            // a floating toolbar rather than crowding the body.
            "-translate-y-1/2",
            // Always rendered so action chips don't pop into existence; toggled
            // via opacity + pointer-events. Hover works on desktop; tapping the
            // message reveals on touch (no hover state).
            actionsActive || anyMenuOpenForThis
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
          )}
        >
          {onReply && message.parentMessageId === null && (
            <button
              type="button"
              onClick={() => {
                onReply(message);
                menu.close();
              }}
              aria-label="Reply"
              className={
                "inline-flex h-9 items-center rounded-full px-3 text-caption text-cream-muted " +
                "transition-colors duration-fast hover:bg-ink hover:text-cream " +
                "focus:outline-none focus-visible:shadow-glow-gold"
              }
            >
              Reply
            </button>
          )}
          {onToggleReaction && isMyReaction && (
            <ReactionPicker
              mid={message.id}
              isMyReaction={isMyReaction}
              onToggle={(mid, slug) => {
                onToggleReaction(mid, slug);
              }}
              disabled={archived}
            />
          )}
          <MessageMoreMenu mid={message.id} items={moreItems} />
        </div>
      )}

      {!isAuthor && resolvedUid && (
        <div data-keep-menu-open>
          <ReportDialog
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            resourceType="message"
            resourceId={message.id}
            groupId={gid}
          />
          <WellbeingFlagDialog
            open={wellbeingOpen}
            onClose={() => setWellbeingOpen(false)}
            subjectUid={message.authorUid}
            subjectName={author.displayName}
            messageId={message.id}
            groupId={gid}
          />
        </div>
      )}
    </article>
  );
}
