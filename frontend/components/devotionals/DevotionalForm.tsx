"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Banner, Button, Input, Select, Textarea } from "@/components/ui";
import { safeHttpUrl } from "@/lib/safeUrl";

const baseFields = {
  title: z.string().min(1, "Title is required").max(200, "Max 200 characters"),
  scriptureRef: z.string().max(200, "Max 200 characters").optional(),
  body: z.string().min(1, "Body is required").max(8000, "Max 8000 characters"),
  audioUrl: z
    .string()
    .refine(
      (v) => v === "" || safeHttpUrl(v) !== null,
      "Must be a valid http or https URL",
    )
    .optional(),
  sourceAttribution: z.string().max(500, "Max 500 characters").optional(),
  publishedAt: z
    .string()
    .refine(
      (v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Must be YYYY-MM-DD",
    )
    .optional(),
  audience: z.enum(["christian", "general"]),
};

// Slug is auto-derived from the title server-side, so create + edit use
// the same schema. Kept as separate exports for callsites that still
// distinguish the two modes.
export const devotionalCreateSchema = z.object(baseFields);
export const devotionalEditSchema = devotionalCreateSchema;

export type DevotionalFormValues = z.infer<typeof devotionalCreateSchema>;

type Props = {
  mode: "create" | "edit";
  defaultValues?: Partial<DevotionalFormValues>;
  submitLabel: string;
  onSubmit: (values: DevotionalFormValues) => Promise<string | null>;
  onCancel?: () => void;
};

export function DevotionalForm({
  mode,
  defaultValues,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DevotionalFormValues>({
    resolver: zodResolver(
      mode === "create" ? devotionalCreateSchema : devotionalEditSchema,
    ),
    defaultValues: {
      title: "",
      scriptureRef: "",
      body: "",
      audioUrl: "",
      sourceAttribution: "",
      publishedAt: "",
      audience: "christian",
      ...defaultValues,
    },
  });

  const handleFormSubmit = async (values: DevotionalFormValues) => {
    setSubmitError(null);
    setSubmitting(true);
    const err = await onSubmit(values);
    if (err) setSubmitError(err);
    setSubmitting(false);
  };

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className="space-y-4"
      noValidate
    >
      <Input
        label="Title"
        required
        placeholder="Devotional title"
        helperText={
          mode === "create"
            ? "The URL is generated from the title."
            : undefined
        }
        error={errors.title?.message}
        {...register("title")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Scripture reference"
          placeholder="e.g. John 3:16"
          error={errors.scriptureRef?.message}
          {...register("scriptureRef")}
        />
        <Input
          label="Published date"
          placeholder="YYYY-MM-DD"
          helperText="Leave blank to publish immediately"
          error={errors.publishedAt?.message}
          {...register("publishedAt")}
        />
      </div>

      <Textarea
        label="Body"
        required
        rows={10}
        placeholder="Write the devotional content here. Markdown is supported (**bold**, *italic*, > blockquote)."
        helperText="Markdown supported"
        error={errors.body?.message}
        {...register("body")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Audio URL"
          placeholder="https://…"
          helperText="Optional podcast or audio link"
          error={errors.audioUrl?.message}
          {...register("audioUrl")}
        />
        <Select
          label="Audience"
          error={errors.audience?.message}
          {...register("audience")}
        >
          <option value="christian">Christian</option>
          <option value="general">General</option>
        </Select>
      </div>

      <Input
        label="Source attribution"
        placeholder="e.g. Public domain, original, etc."
        error={errors.sourceAttribution?.message}
        {...register("sourceAttribution")}
      />

      {submitError && <Banner tone="error">{submitError}</Banner>}

      <div className="flex items-center justify-end gap-3">
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={submitting}
          disabled={submitting}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
