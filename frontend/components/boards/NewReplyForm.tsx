"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Banner, Button, Card } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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

const replyBodyClass =
  "w-full resize-none rounded border border-line bg-ink-overlay px-3 py-2 " +
  "font-sans text-body text-cream placeholder:text-cream-dim " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

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
      <Card surface="raised" padding="sm">
        <p className="text-body-sm text-cream-muted">
          This board is archived. Replies are disabled.
        </p>
      </Card>
    );
  }

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiPost(`/api/boards/${boardId}/posts/${postId}/replies`, {
        body: values.body.trim(),
        stickerIds: [],
        mediaRefs: [],
        mentions: [],
      });
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "archived") {
          setError("This board is archived. Replies are disabled.");
        } else {
          setError("Failed to reply. Please try again.");
        }
      } else {
        setError("Failed to reply. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card surface="raised" padding="sm">
      <form onSubmit={handleSubmit(onSubmit)} aria-label="New reply">
        <textarea
          {...register("body")}
          rows={2}
          maxLength={4000}
          aria-label="Reply body"
          placeholder="Write a reply…"
          className={replyBodyClass}
        />
        {errors.body && (
          <p role="alert" className="mt-1 text-caption text-terracotta">
            {errors.body.message}
          </p>
        )}

        {error && (
          <div className="mt-2">
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <div className="mt-2 flex items-center justify-end">
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? "Sending…" : "Reply"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
