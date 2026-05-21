"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { StickerPicker } from "@/components/stickers/StickerPicker";
import { Banner, Button, Card } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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
  /**
   * Board audience — when "christian", narrows the sticker picker to
   * christian + general stickers (9 of 15) and hides the BJJ-specific
   * set. "general" boards fall through to all stickers (legacy). Mirrors
   * the wiring landed for chat in PR #280.
   */
  boardAudience?: "christian" | "general";
};

const postBodyClass =
  "mt-3 w-full resize-none rounded border border-line bg-ink-overlay px-3 py-2 " +
  "font-sans text-body text-cream placeholder:text-cream-muted " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

export function NewPostForm({
  boardId,
  archived = false,
  boardAudience,
}: Props) {
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
      <Card surface="raised" padding="sm">
        <p className="text-body-sm text-cream-muted">
          This board is archived. New posts are disabled.
        </p>
      </Card>
    );
  }

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiPost(`/api/boards/${boardId}/posts`, {
        body: values.body.trim(),
        stickerIds: values.stickerIds,
        mediaRefs: [],
        mentions: [],
      });
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "archived") {
          setError("This board is archived. New posts are disabled.");
        } else if (err.code === "banned") {
          setError("Your account is currently restricted from posting.");
        } else {
          setError("Failed to post. Please try again.");
        }
      } else {
        setError("Failed to post. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card surface="raised" padding="md">
      <form onSubmit={handleSubmit(onSubmit)} aria-label="New board post">
        <Controller
          name="stickerIds"
          control={control}
          render={({ field }) => (
            <StickerPicker
              value={field.value}
              onChange={field.onChange}
              groupAudience={
                boardAudience === "christian" ? "christian" : undefined
              }
            />
          )}
        />
        {errors.stickerIds && (
          <p role="alert" className="mt-1 text-caption text-terracotta">
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
              className={postBodyClass}
            />
          )}
        />
        {errors.body && (
          <p role="alert" className="mt-1 text-caption text-terracotta">
            {errors.body.message}
          </p>
        )}

        {error && (
          <div className="mt-3">
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <div className="mt-3 flex items-center justify-end">
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
