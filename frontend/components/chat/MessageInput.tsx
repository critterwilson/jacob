"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { useAuth } from "@/lib/auth-context";
import {
  DEFAULT_STICKER_SLUG,
  StickerPicker,
} from "@/components/stickers/StickerPicker";
import { firestore } from "@/lib/firebase";

const schema = z.object({
  body: z
    .string()
    .min(1, "Message cannot be empty")
    .max(4000, "Message must be 4000 characters or less"),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  gid: string;
};

export function MessageInput({ gid }: Props) {
  const { user } = useAuth();
  const [stickers, setStickers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSending(true);
    setError(null);

    const finalStickers =
      stickers.length > 0 ? stickers : [DEFAULT_STICKER_SLUG];

    try {
      await addDoc(collection(firestore, "groups", gid, "messages"), {
        authorUid: user.uid,
        body: values.body.trim(),
        stickerIds: finalStickers,
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        threadReplyCount: 0,
        mediaRefs: [],
      });
      reset();
      setStickers([]);
    } catch {
      setError("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Send a message"
      className="border-t border-gray-200 px-4 py-3"
    >
      <StickerPicker value={stickers} onChange={setStickers} />

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
