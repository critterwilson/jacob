"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { z } from "zod";

import { MentionInput } from "@/components/chat/MentionInput";
import { PhotoAttachButton } from "@/components/chat/PhotoAttachButton";
import {
  DEFAULT_STICKER_SLUG,
  StickerPicker,
} from "@/components/stickers/StickerPicker";
import { Button } from "@/components/ui";
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
};

export function MessageInput({ gid, archived = false, onTyping }: Props) {
  const { user } = useAuth();
  const { members } = useMembers(gid);
  const [stickers, setStickers] = useState<string[]>([]);
  const [mediaRefs, setMediaRefs] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { body: "" },
  });

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    const trimmedBody = values.body.trim();
    if (!trimmedBody && mediaRefs.length === 0) {
      setError("Add a message or a photo before sending.");
      return;
    }

    setSending(true);
    setError(null);

    const finalStickers =
      stickers.length > 0 ? stickers : [DEFAULT_STICKER_SLUG];

    const mentions = extractMentionedUids(trimmedBody, members);

    try {
      await apiPost(`/api/groups/${gid}/messages`, {
        body: trimmedBody,
        stickerIds: finalStickers,
        mediaRefs,
        parentMessageId: null,
        mentions,
      });
      reset();
      setStickers([]);
      setMediaRefs([]);
      onTyping?.(false);
    } catch (err) {
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

  const removePhoto = (url: string) =>
    setMediaRefs((prev) => prev.filter((u) => u !== url));

  if (archived) {
    return (
      <div className="border-t border-line bg-ink px-4 py-3 text-center text-body-sm text-cream-muted">
        This group is archived. New messages are disabled.
      </div>
    );
  }

  const mentionInputClass =
    "flex-1 resize-none rounded border border-line bg-ink-overlay px-3 py-2 " +
    "font-sans text-body text-cream placeholder:text-cream-dim " +
    "transition-colors duration-fast " +
    "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Send a message"
      className="border-t border-line bg-ink px-4 py-3"
    >
      <StickerPicker value={stickers} onChange={setStickers} />

      {mediaRefs.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached photos">
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
                className="absolute -right-1 -top-1 rounded-full bg-ink-overlay px-1.5 text-caption text-cream-muted hover:text-cream focus:outline-none focus-visible:shadow-glow-gold"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <Controller
          name="body"
          control={control}
          render={({ field }) => (
            <MentionInput
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                if (onTyping) onTyping(v.trim().length > 0);
              }}
              onBlur={() => {
                field.onBlur();
                onTyping?.(false);
              }}
              members={members}
              aria-label="Message body"
              placeholder="Say something…"
              rows={2}
              maxLength={4000}
              className={mentionInputClass}
            />
          )}
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={sending}
          disabled={sending}
          className="self-end"
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>

      <div className="mt-2">
        <PhotoAttachButton
          gid={gid}
          disabled={mediaRefs.length >= MAX_PHOTOS_PER_MESSAGE}
          onAttach={(url) => setMediaRefs((prev) => [...prev, url])}
          onError={setError}
        />
      </div>

      {errors.body && (
        <p role="alert" className="mt-2 text-caption text-terracotta">
          {errors.body.message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-caption text-terracotta">
          {error}
        </p>
      )}
    </form>
  );
}
