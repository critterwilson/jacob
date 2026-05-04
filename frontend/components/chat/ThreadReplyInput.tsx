"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const schema = z.object({
  body: z
    .string()
    .min(1, "Reply cannot be empty")
    .max(4000, "Reply must be 4000 characters or less"),
  alsoPostToChannel: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  gid: string;
  parentMessageId: string;
  parentStickerIds: string[];
};

export function ThreadReplyInput({ gid, parentMessageId, parentStickerIds }: Props) {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { alsoPostToChannel: false },
  });

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSending(true);
    setError(null);

    const trimmed = values.body.trim();

    try {
      await apiPost(`/api/groups/${gid}/messages`, {
        body: trimmed,
        stickerIds: parentStickerIds,
        mediaRefs: [],
        parentMessageId,
        mentions: [],
      });

      if (values.alsoPostToChannel) {
        await apiPost(`/api/groups/${gid}/messages`, {
          body: trimmed,
          stickerIds: parentStickerIds,
          mediaRefs: [],
          parentMessageId: null,
          mentions: [],
          repostOfThread: parentMessageId,
        });
      }

      reset();
    } catch (err) {
      if (err instanceof ApiError && err.code === "archived") {
        setError("This group is archived. Replies are disabled.");
      } else {
        setError("Failed to send reply. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-label="Reply to thread"
      className="border-t border-gray-200 px-4 py-3"
    >
      <div className="flex gap-2">
        <textarea
          {...register("body")}
          aria-label="Reply body"
          placeholder="Reply…"
          rows={2}
          maxLength={4000}
          className="flex-1 resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={sending}
          className="self-end rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Reply"}
        </button>
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          {...register("alsoPostToChannel")}
          className="rounded"
        />
        Also post to channel
      </label>

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
