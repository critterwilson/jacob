"use client";

import { useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { useAuth } from "@/lib/auth-context";
import { StickerBadge } from "@/components/stickers/StickerBadge";
import { useStickers } from "@/lib/hooks/useStickers";
import { firestore } from "@/lib/firebase";
import type { Message } from "@/lib/hooks/useGroupMessages";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

type Props = {
  gid: string;
  message: Message;
  isLeader: boolean;
  onReply?: (message: Message) => void;
  currentUserUid?: string;
};

export function MessageItem({ gid, message, isLeader, onReply, currentUserUid }: Props) {
  const { user } = useAuth();
  const resolvedUid = currentUserUid ?? user?.uid;
  const { stickers } = useStickers();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthor = resolvedUid === message.authorUid;
  const hasParticipated = message.participants?.includes(resolvedUid ?? "") ?? false;
  const createdAtMs = message.createdAt?.toMillis() ?? 0;
  const isDeleted = message.deletedAt != null;
  const canEdit =
    isAuthor && !isDeleted && Date.now() - createdAtMs < FIFTEEN_MIN_MS;
  const canDelete = (isAuthor || isLeader) && !isDeleted;

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
      await updateDoc(doc(firestore, "groups", gid, "messages", message.id), {
        body: trimmed,
        editedAt: serverTimestamp(),
      });
      setEditing(false);
    } catch {
      setError("Failed to save edit.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await updateDoc(doc(firestore, "groups", gid, "messages", message.id), {
        deletedAt: serverTimestamp(),
      });
    } catch {
      setError("Failed to delete message.");
    }
  };

  return (
    <article
      data-message-id={message.id}
      className="group relative flex flex-col gap-1 px-4 py-2 hover:bg-gray-50"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-gray-900">
          {isAuthor ? "You" : message.authorUid}
        </span>
        <time className="text-xs text-gray-400">{timestamp}</time>
        {message.editedAt && !isDeleted && (
          <span className="text-xs text-gray-400">(edited)</span>
        )}
      </div>

      {isDeleted ? (
        <p className="text-sm italic text-gray-400">[message removed]</p>
      ) : editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="Edit message"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            maxLength={4000}
            rows={2}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleEdit()}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditBody(message.body);
              }}
              className="rounded border border-gray-300 px-3 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-gray-800">
          {message.body}
        </p>
      )}

      {messageStickers.length > 0 && !isDeleted && (
        <div className="flex flex-wrap gap-1">
          {messageStickers.map((s) => (
            <StickerBadge key={s.slug} sticker={s} size="sm" />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {!isDeleted && message.parentMessageId === null && message.threadReplyCount > 0 && (
        <button
          type="button"
          onClick={() => onReply?.(message)}
          aria-label={`${message.threadReplyCount} ${message.threadReplyCount === 1 ? "reply" : "replies"}, open thread`}
          className="flex items-center gap-1 self-start text-xs text-blue-600 hover:underline"
        >
          {hasParticipated && (
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500"
            />
          )}
          {message.threadReplyCount}{" "}
          {message.threadReplyCount === 1 ? "reply" : "replies"}
        </button>
      )}

      {!isDeleted && !editing && (canEdit || canDelete || (onReply && message.parentMessageId === null)) && (
        <div className="absolute right-4 top-2 hidden gap-1 group-hover:flex">
          {onReply && message.parentMessageId === null && (
            <button
              type="button"
              onClick={() => onReply(message)}
              className="rounded border border-gray-200 px-2 py-0.5 text-xs hover:bg-white"
            >
              Reply
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-gray-200 px-2 py-0.5 text-xs hover:bg-white"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="rounded border border-gray-200 px-2 py-0.5 text-xs hover:bg-white"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </article>
  );
}
