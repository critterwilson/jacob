"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState, type KeyboardEvent } from "react";
import { z } from "zod";

import {
  MentionInput,
  type MentionInputHandle,
} from "@/components/chat/MentionInput";
import { PhotoAttachButton } from "@/components/chat/PhotoAttachButton";
import {
  DEFAULT_STICKER_SLUG,
  StickerPicker,
} from "@/components/stickers/StickerPicker";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useMembers } from "@/lib/hooks/useMembers";
import { extractMentionedUids } from "@/lib/mentions";

const MAX_PHOTOS_PER_MESSAGE = 4;

const schema = z.object({
  body: z.string().max(4000, "Message must be 4000 characters or less"),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  gid: string;
  archived?: boolean;
  /**
   * T48 — fired on every input change with `true`, on submit/blur
   * with `false`. The chat page wires this to `useTyping().setTyping`
   * so other members see "Alice is typing…". The hook is internally
   * debounced — it's safe to call this on every keystroke.
   */
  onTyping?: (active: boolean) => void;
  /** T56 — filters the sticker picker to the group's audience + general. */
  groupAudience?: "christian" | "general";
};

function StickerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15.5 3H8a5 5 0 0 0-5 5v8a5 5 0 0 0 5 5h6.5a1 1 0 0 0 .707-.293L20.207 15.5A1 1 0 0 0 20.5 14.793V8a5 5 0 0 0-5-5Z" />
      <path d="M15 21v-3.5a2.5 2.5 0 0 1 2.5-2.5H21" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
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
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function MessageInput({ gid, archived = false, onTyping, groupAudience }: Props) {
  const { user } = useAuth();
  const { members } = useMembers(gid);
  const [stickers, setStickers] = useState<string[]>([]);
  const [mediaRefs, setMediaRefs] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stickerPanelOpen, setStickerPanelOpen] = useState(false);
  const inputRef = useRef<MentionInputHandle>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { body: "" },
  });

  const bodyValue = watch("body");
  const hasContent = bodyValue.trim().length > 0 || mediaRefs.length > 0;

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    const trimmedBody = values.body.trim();
    if (!trimmedBody && mediaRefs.length === 0) {
      setError("Add a message or a photo before sending.");
      return;
    }

    const finalStickers =
      stickers.length > 0 ? stickers : [DEFAULT_STICKER_SLUG];
    const mentions = extractMentionedUids(trimmedBody, members);

    // Optimistic clear — the composer empties immediately so typing the
    // next message doesn't have to wait for the POST round-trip. If the
    // send fails we restore the body so the user can retry.
    const snapshot = {
      body: values.body,
      stickers,
      mediaRefs: [...mediaRefs],
    };
    reset({ body: "" });
    setStickers([]);
    setMediaRefs([]);
    setStickerPanelOpen(false);
    onTyping?.(false);

    setSending(true);
    setError(null);

    try {
      await apiPost(`/api/groups/${gid}/messages`, {
        body: trimmedBody,
        stickerIds: finalStickers,
        mediaRefs: snapshot.mediaRefs,
        parentMessageId: null,
        mentions,
      });
    } catch (err) {
      // Restore so the user can retry without retyping.
      reset({ body: snapshot.body });
      setStickers(snapshot.stickers);
      setMediaRefs(snapshot.mediaRefs);
      if (err instanceof ApiError) {
        if (err.code === "archived") {
          setError("This group is archived. Messages are disabled.");
        } else if (err.code === "banned") {
          setError("Your account is currently restricted from posting.");
        } else {
          setError("Failed to send message. Please try again.");
        }
      } else {
        setError("Failed to send message. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter submits — a familiar shortcut on a multiline
    // composer where a bare Enter inserts a newline. We intentionally
    // do *not* hijack a bare Enter so users can format messages without
    // accidental sends.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit(onSubmit)();
    }
  };

  const removePhoto = (url: string) =>
    setMediaRefs((prev) => prev.filter((u) => u !== url));

  if (archived) {
    return (
      <div className="border-t border-line bg-ink px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-center text-body-sm text-cream-muted">
        This group is archived. New messages are disabled.
      </div>
    );
  }

  const textareaClass =
    "block w-full resize-none rounded-2xl border border-line bg-ink-overlay px-3 py-2.5 " +
    "font-sans text-body text-cream placeholder:text-cream-muted " +
    "transition-colors duration-fast " +
    "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

  const stickerCount = stickers.length;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Send a message"
      className="shrink-0 border-t border-line bg-ink px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]"
    >
      {mediaRefs.length > 0 && (
        <ul
          className="mb-2 flex flex-wrap gap-2 px-1"
          aria-label="Attached photos"
        >
          {mediaRefs.map((url) => (
            <li key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="Attached"
                className="h-16 w-16 rounded-md border border-line object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(url)}
                aria-label="Remove attached photo"
                className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-overlay text-caption text-cream-muted hover:text-cream focus:outline-none focus-visible:shadow-glow-gold"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {stickerPanelOpen && (
        <div className="mb-2 rounded-xl bg-ink-raised px-2 pb-1 pt-2">
          <StickerPicker
            value={stickers}
            onChange={setStickers}
            groupAudience={groupAudience}
          />
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <PhotoAttachButton
          gid={gid}
          variant="icon"
          disabled={mediaRefs.length >= MAX_PHOTOS_PER_MESSAGE}
          onAttach={(url) => setMediaRefs((prev) => [...prev, url])}
          onError={setError}
        />

        <Controller
          name="body"
          control={control}
          render={({ field }) => (
            <MentionInput
              ref={inputRef}
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                if (onTyping) onTyping(v.trim().length > 0);
              }}
              onBlur={() => {
                field.onBlur();
                onTyping?.(false);
              }}
              onKeyDown={handleKeyDown}
              members={members}
              aria-label="Message body"
              placeholder="Say something…"
              rows={1}
              maxRows={6}
              maxLength={4000}
              containerClassName="relative min-w-0 flex-1"
              className={textareaClass}
            />
          )}
        />

        <button
          type="button"
          onClick={() => setStickerPanelOpen((v) => !v)}
          aria-label={
            stickerPanelOpen
              ? "Hide stickers"
              : stickerCount > 0
                ? `Stickers (${stickerCount} selected)`
                : "Pick stickers"
          }
          aria-expanded={stickerPanelOpen}
          aria-pressed={stickerCount > 0}
          className={
            "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cream-muted " +
            "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
            "focus:outline-none focus-visible:shadow-glow-gold " +
            (stickerPanelOpen || stickerCount > 0 ? "bg-ink-overlay text-cream" : "")
          }
        >
          <StickerIcon className="h-5 w-5" />
          {stickerCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gold px-1 text-[0.625rem] font-semibold text-ink"
            >
              {stickerCount}
            </span>
          )}
        </button>

        <button
          type="submit"
          aria-label={sending ? "Sending message" : "Send message"}
          aria-busy={sending || undefined}
          aria-disabled={!hasContent || undefined}
          disabled={sending}
          className={
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full " +
            "transition-all duration-fast " +
            "focus:outline-none focus-visible:shadow-glow-gold " +
            "disabled:cursor-not-allowed " +
            (hasContent
              ? "bg-gold text-ink hover:bg-gold-soft active:bg-gold-deep"
              : "bg-ink-overlay text-cream-muted hover:text-cream")
          }
        >
          <SendIcon className="h-5 w-5" />
          {/* sr-only fallback text so the test suite (and screen
              readers without aria-label support) can still find a
              button named "Send". */}
          <span className="sr-only">{sending ? "Sending…" : "Send"}</span>
        </button>
      </div>

      {errors.body && (
        <p role="alert" className="mt-2 px-1 text-caption text-terracotta">
          {errors.body.message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 px-1 text-caption text-terracotta">
          {error}
        </p>
      )}
    </form>
  );
}
