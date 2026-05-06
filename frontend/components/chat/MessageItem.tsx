"use client";

import { useState } from "react";

import { ApiError, apiDelete, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { MessageBody } from "@/components/chat/MessageBody";
import { PhotoView } from "@/components/chat/PhotoView";
import { ReactionBar } from "@/components/chat/ReactionBar";
import { ReactionPicker } from "@/components/chat/ReactionPicker";
import { ReportButton } from "@/components/moderation/ReportButton";
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
}: Props) {
  const { user } = useAuth();
  const resolvedUid = currentUserUid ?? user?.uid;
  const { stickers } = useStickers();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const actionChip =
    "rounded border border-line bg-ink px-2 py-0.5 text-caption text-cream-muted " +
    "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
    "focus:outline-none focus-visible:shadow-glow-gold";

  return (
    <article
      data-message-id={message.id}
      className="group relative flex gap-3 px-4 py-2 transition-colors duration-fast hover:bg-ink-raised"
    >
      <Avatar
        name={author.displayName}
        photoURL={author.photoURL}
        size="sm"
        aria-hidden="true"
        className="mt-1"
      />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-body-sm font-semibold text-cream">
            {author.displayName}
          </span>
          <time className="text-caption text-cream-dim">{timestamp}</time>
          {message.editedAt && !isDeleted && (
            <span className="text-caption text-cream-dim">(edited)</span>
          )}
        </div>

        {isDeleted ? (
          <p className="text-body-sm italic text-cream-dim">[message removed]</p>
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
          <div className="flex flex-wrap gap-1 pt-1">
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
                  className="max-h-64 w-auto rounded-md border border-line"
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
        <div className="absolute right-4 top-2 hidden gap-1 group-hover:flex">
          {onReply && message.parentMessageId === null && (
            <button
              type="button"
              onClick={() => onReply(message)}
              className={actionChip}
            >
              Reply
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={actionChip}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              className={actionChip}
            >
              Delete
            </button>
          )}
          {isLeader && onTogglePin && (
            <button
              type="button"
              onClick={() => onTogglePin(message.id)}
              className={actionChip}
            >
              {pinnedIds.includes(message.id) ? "Unpin" : "Pin"}
            </button>
          )}
          {isLeader && onAnnounce && !message.announcedAt && (
            <button
              type="button"
              onClick={() => onAnnounce(message.id)}
              className={actionChip}
            >
              Announce
            </button>
          )}
          {onToggleReaction && isMyReaction && (
            <ReactionPicker
              mid={message.id}
              isMyReaction={isMyReaction}
              onToggle={onToggleReaction}
              disabled={archived}
            />
          )}
          {!isAuthor && (
            <ReportButton
              resourceType="message"
              resourceId={message.id}
              groupId={gid}
              className={cn(actionChip, "flex items-center text-cream-dim")}
            />
          )}
        </div>
      )}
    </article>
  );
}
