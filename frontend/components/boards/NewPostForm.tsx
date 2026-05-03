"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";
import { StickerPicker } from "@/components/stickers/StickerPicker";

// Mirrors backend rule constraint: ≥1 sticker, body 1-4000 chars.
const schema = z.object({
  body: z
    .string()
    .min(1, "Write a post")
    .max(4000, "Posts must be 4000 characters or less"),
  stickerIds: z.array(z.string()).min(1, "Pick at least one sticker"),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  boardId: string;
  archived?: boolean;
};

export function NewPostForm({ boardId, archived = false }: Props) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { body: "", stickerIds: [] },
  });

  if (archived) {
    return (
      <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        This board is archived. New posts are disabled.
      </div>
    );
  }

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      await addDoc(collection(firestore, "boards", boardId, "posts"), {
        authorUid: user.uid,
        body: values.body.trim(),
        stickerIds: values.stickerIds,
        mediaRefs: [],
        createdAt: serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        replyCount: 0,
        reactionCounts: {},
      });
      reset();
    } catch {
      setError("Failed to post. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="New board post"
      className="rounded border border-gray-200 bg-white p-4"
    >
      <Controller
        name="stickerIds"
        control={control}
        render={({ field }) => (
          <StickerPicker value={field.value} onChange={field.onChange} />
        )}
      />
      {errors.stickerIds && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {errors.stickerIds.message}
        </p>
      )}

      <Controller
        name="body"
        control={control}
        render={({ field }) => (
          <textarea
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            rows={3}
            maxLength={4000}
            aria-label="Post body"
            placeholder="Share something with everyone…"
            className="mt-3 w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      />
      {errors.body && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {errors.body.message}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        {error ? (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
