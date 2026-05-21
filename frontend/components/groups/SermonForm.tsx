"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Banner, Button, Input } from "@/components/ui";
import { safeHttpUrl } from "@/lib/safeUrl";

// Optional string fields — the form always provides "" via defaultValues, so
// these are always strings at submission time; the schema accepts both "" and
// a valid value so no coercion is needed.
const editFields = {
  title: z.string().max(200, "Max 200 characters").optional(),
  preacher: z.string().max(120, "Max 120 characters").optional(),
  scripture: z.string().max(200, "Max 200 characters").optional(),
  sermonDate: z
    .string()
    .refine(
      (v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Must be YYYY-MM-DD",
    )
    .optional(),
};

const baseSchema = z.object({
  sourceUrl: z.string(),
  ...editFields,
});

export type SermonFormValues = z.infer<typeof baseSchema>;

/** Create variant — adds sourceUrl validation on top of the base schema. */
export const sermonCreateSchema = baseSchema.superRefine((data, ctx) => {
  if (!data.sourceUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "URL is required",
      path: ["sourceUrl"],
    });
  } else if (safeHttpUrl(data.sourceUrl) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Must be a valid http or https URL",
      path: ["sourceUrl"],
    });
  }
});

export const sermonEditSchema = z.object(editFields);

type Props = {
  mode: "create" | "edit";
  defaultValues?: Partial<SermonFormValues>;
  submitLabel: string;
  onSubmit: (values: SermonFormValues) => Promise<string | null>;
  onCancel?: () => void;
};

export function SermonForm({
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
  } = useForm<SermonFormValues>({
    resolver: zodResolver(
      mode === "create" ? sermonCreateSchema : (sermonEditSchema as typeof baseSchema),
    ),
    defaultValues: {
      sourceUrl: "",
      title: "",
      preacher: "",
      scripture: "",
      sermonDate: "",
      ...defaultValues,
    },
  });

  const handleFormSubmit = async (values: SermonFormValues) => {
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
      {mode === "create" && (
        <Input
          label="Source URL"
          required
          placeholder="https://youtube.com/watch?v=… or podcast link"
          helperText="YouTube titles are auto-filled when title is left blank"
          error={errors.sourceUrl?.message}
          {...register("sourceUrl")}
        />
      )}
      <Input
        label="Title"
        placeholder={
          mode === "create" ? "Auto-filled for YouTube" : "Sermon title"
        }
        error={errors.title?.message}
        {...register("title")}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="Preacher"
          placeholder="Preacher name"
          error={errors.preacher?.message}
          {...register("preacher")}
        />
        <Input
          label="Scripture"
          placeholder="e.g. John 3:16"
          error={errors.scripture?.message}
          {...register("scripture")}
        />
        <Input
          label="Date preached"
          placeholder="YYYY-MM-DD"
          error={errors.sermonDate?.message}
          {...register("sermonDate")}
        />
      </div>

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
