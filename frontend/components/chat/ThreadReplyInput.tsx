"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui";

const replyTextareaClass =
  "flex-1 resize-none rounded border border-line bg-ink-overlay px-3 py-2 " +
  "font-sans text-body text-cream placeholder:text-cream-muted " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";
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

export function ThreadReplyInput({
  gid,
  parentMessageId,
  parentStickerIds,
}: Props) {
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
      className="border-t border-line bg-ink px-4 py-3"
    >
      <div className="flex gap-2">
        <textarea
          aria-label="Reply body"
          placeholder="Reply…"
          rows={2}
          maxLength={4000}
          {...register("body")}
          className={replyTextareaClass}
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={sending}
          disabled={sending}
          className="self-end"
        >
          {sending ? "Sending…" : "Reply"}
        </Button>
      </div>

      <label className="mt-2 flex cursor-pointer items-center gap-2 text-caption text-cream-muted">
        <input
          type="checkbox"
          {...register("alsoPostToChannel")}
          className="h-3.5 w-3.5 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
        />
        Also post to channel
      </label>

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
