"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Banner, Button, Card } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

// Mirrors backend `CreateMinistryPostRequest`.
const schema = z.object({
  title: z
    .string()
    .min(1, "Give the post a title")
    .max(200, "Title must be 200 characters or fewer"),
  body: z
    .string()
    .min(1, "Write a body")
    .max(8000, "Body must be 8000 characters or fewer"),
  sermonUrl: z
    .union([z.literal(""), z.string().url("Must be a valid URL")])
    .optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  onPosted?: () => void;
};

const inputClass =
  "mt-2 w-full rounded border border-line bg-ink-overlay px-3 py-2 " +
  "font-sans text-body text-cream placeholder:text-cream-muted " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:border-gold focus-visible:shadow-glow-gold";

export function NewMinistryPostForm({ onPosted }: Props) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", body: "", sermonUrl: "" },
  });

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Record<string, unknown> = {
        title: values.title.trim(),
        body: values.body,
      };
      if (values.sermonUrl && values.sermonUrl.trim()) {
        payload.sermonUrl = values.sermonUrl.trim();
      }
      await apiPost("/api/ministry-feed/posts", payload);
      reset();
      setSuccess("Post published.");
      onPosted?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "forbidden") {
        setError("You don't have permission to post here.");
      } else {
        setError("Failed to publish. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card surface="raised" padding="md">
      <form
        onSubmit={handleSubmit(onSubmit)}
        aria-label="New organization post"
        className="space-y-3"
      >
        <div>
          <label
            htmlFor="ministry-title"
            className="text-caption font-medium text-cream-muted"
          >
            Title
          </label>
          <Controller
            name="title"
            control={control}
            render={({ field }) => (
              <input
                {...field}
                id="ministry-title"
                type="text"
                maxLength={200}
                placeholder="Sunday devotional"
                className={inputClass}
              />
            )}
          />
          {errors.title && (
            <p role="alert" className="mt-1 text-caption text-terracotta">
              {errors.title.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="ministry-body"
            className="text-caption font-medium text-cream-muted"
          >
            Body
          </label>
          <Controller
            name="body"
            control={control}
            render={({ field }) => (
              <textarea
                {...field}
                id="ministry-body"
                rows={6}
                maxLength={8000}
                placeholder="Markdown is supported."
                className={inputClass}
              />
            )}
          />
          {errors.body && (
            <p role="alert" className="mt-1 text-caption text-terracotta">
              {errors.body.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="ministry-sermon-url"
            className="text-caption font-medium text-cream-muted"
          >
            Sermon link (optional)
          </label>
          <Controller
            name="sermonUrl"
            control={control}
            render={({ field }) => (
              <input
                {...field}
                id="ministry-sermon-url"
                type="url"
                inputMode="url"
                placeholder="https://…"
                className={inputClass}
              />
            )}
          />
          {errors.sermonUrl && (
            <p role="alert" className="mt-1 text-caption text-terracotta">
              {errors.sermonUrl.message}
            </p>
          )}
        </div>

        {error && <Banner tone="error">{error}</Banner>}
        {success && <Banner tone="success">{success}</Banner>}

        <div className="flex items-center justify-end">
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
