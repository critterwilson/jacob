"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useAuth } from "@/lib/auth-context";
import { firestore } from "@/lib/firebase";

const schema = z.object({
  body: z
    .string()
    .min(1, "Reply cannot be empty")
    .max(4000, "Replies must be 4000 characters or less"),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  boardId: string;
  postId: string;
  archived?: boolean;
};

export function NewReplyForm({ boardId, postId, archived = false }: Props) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
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

  if (archived) {
    return (
      <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        This board is archived. Replies are disabled.
      </div>
    );
  }

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      await addDoc(
        collection(firestore, "boards", boardId, "posts", postId, "replies"),
        {
          authorUid: user.uid,
          body: values.body.trim(),
          stickerIds: [],
          mediaRefs: [],
          createdAt: serverTimestamp(),
          editedAt: null,
          deletedAt: null,
        },
      );
      reset();
    } catch {
      setError("Failed to reply. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="New reply"
      className="rounded border border-gray-200 bg-white p-3"
    >
      <textarea
        {...register("body")}
        rows={2}
        maxLength={4000}
        aria-label="Reply body"
        placeholder="Write a reply…"
        className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {errors.body && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {errors.body.message}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
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
          {submitting ? "Sending…" : "Reply"}
        </button>
      </div>
    </form>
  );
}
