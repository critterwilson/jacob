"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { useAuth } from "@/lib/auth-context";
import { PhotoAttachButton } from "@/components/chat/PhotoAttachButton";
import {
  DEFAULT_STICKER_SLUG,
  StickerPicker,
} from "@/components/stickers/StickerPicker";
import { firestore } from "@/lib/firebase";

const MAX_PHOTOS_PER_MESSAGE = 4;

// Body itself is permissive: photo-only messages are allowed, so we only
// gate on max length here. The "must contain text or a photo" rule is
// enforced in `onSubmit` because it depends on `mediaRefs` state, which
// react-hook-form doesn't see.
const schema = z.object({
  body: z.string().max(4000, "Message must be 4000 characters or less"),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  gid: string;
  archived?: boolean;
};

export function MessageInput({ gid, archived = false }: Props) {
  const { user } = useAuth();
  const [stickers, setStickers] = useState<string[]>([]);
  const [mediaRefs, setMediaRefs] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
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

    try {
      await addDoc(collection(firestore, "groups", gid, "messages"), {
        authorUid: user.uid,
        body: trimmedBody,
        stickerIds: finalStickers,
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs,
      });
      reset();
      setStickers([]);
      setMediaRefs([]);
    } catch (err) {
      const msg = err instanceof Error && err.message.includes("permission-denied")
        ? "Group was archived."
        : "Failed to send message. Please try again.";
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const removePhoto = (url: string) =>
    setMediaRefs((prev) => prev.filter((u) => u !== url));

  if (archived) {
    return (
      <div
        aria-label="Message input disabled"
        className="border-t border-gray-200 px-4 py-3 text-center text-sm text-gray-500"
      >
        This group is archived. New messages are disabled.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Send a message"
      className="border-t border-gray-200 px-4 py-3"
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
                className="h-16 w-16 rounded object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(url)}
                aria-label="Remove attached photo"
                className="absolute -right-1 -top-1 rounded-full bg-gray-900 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <textarea
          {...register("body")}
          aria-label="Message body"
          placeholder="Say something…"
          rows={2}
          maxLength={4000}
          className="flex-1 resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={sending}
          className="self-end rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
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
        <p role="alert" className="mt-1 text-xs text-red-600">
          {errors.body.message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
