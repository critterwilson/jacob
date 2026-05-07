"use client";

import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import {
  type ReportReason,
  type ReportResourceType,
  useReport,
} from "@/lib/hooks/useReport";

const reasonOptions: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "sexual", label: "Sexual or explicit content" },
  { value: "violence", label: "Violence or threats" },
  { value: "self-harm", label: "Self-harm or suicide" },
  { value: "spam", label: "Spam or unwanted content" },
  { value: "other", label: "Something else" },
];

const formSchema = z.object({
  reason: z.enum([
    "harassment",
    "sexual",
    "violence",
    "self-harm",
    "spam",
    "other",
  ]),
  context: z.string().max(500),
});

type FormValues = z.infer<typeof formSchema>;

type Props = {
  open: boolean;
  onClose: () => void;
  resourceType: ReportResourceType;
  resourceId: string;
  groupId?: string;
};

export function ReportDialog({
  open,
  onClose,
  resourceType,
  resourceId,
  groupId,
}: Props) {
  const reasonId = useId();
  const contextId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: onClose,
  });
  const { submit, submitting, error } = useReport();
  const [success, setSuccess] = useState<{ dedup: boolean } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: "harassment", context: "" },
  });

  useEffect(() => {
    if (!open) return;
    setSuccess(null);
    reset({ reason: "harassment", context: "" });
  }, [open, reset]);

  if (!open) return null;

  const onSubmit = async (values: FormValues) => {
    const result = await submit({
      resourceType,
      resourceId,
      groupId,
      reason: values.reason,
      context: values.context,
    });
    if (result) {
      setSuccess({ dedup: result.dedup });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Dismiss report dialog"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/40 focus:outline-none focus-visible:shadow-glow-gold"
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg bg-ink-raised p-6 shadow-pop outline-none"
      >
        <h2 id="report-dialog-title" className="mb-1 text-lg font-semibold">
          Report this {resourceType}
        </h2>
        <p className="mb-4 text-sm text-cream-muted">
          Reports go to JACOB&apos;s moderation team. We review every report.
        </p>

        {success ? (
          <div className="space-y-4" data-testid="report-success">
            <p className="rounded bg-sage/15 p-3 text-sm text-sage">
              {success.dedup
                ? "Thanks — we already have this report on file."
                : "Thanks — your report has been sent for review."}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-soft"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(onSubmit)(e);
            }}
            className="space-y-4"
            noValidate
          >
            <div>
              <label
                htmlFor={reasonId}
                className="mb-1 block text-sm font-medium text-cream"
              >
                Reason
              </label>
              <select
                id={reasonId}
                {...register("reason")}
                className="w-full rounded border border-line bg-ink-overlay px-2 py-1 text-sm text-cream focus:outline-none focus-visible:shadow-glow-gold"
              >
                {reasonOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {errors.reason && (
                <p className="mt-1 text-xs text-terracotta">
                  {errors.reason.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={contextId}
                className="mb-1 block text-sm font-medium text-cream"
              >
                Add context (optional, max 500 chars)
              </label>
              <textarea
                id={contextId}
                rows={4}
                maxLength={500}
                {...register("context")}
                className="w-full rounded border border-line bg-ink-overlay px-2 py-1 text-sm text-cream focus:outline-none focus-visible:shadow-glow-gold"
              />
              {errors.context && (
                <p className="mt-1 text-xs text-terracotta">
                  {errors.context.message}
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded bg-terracotta/15 p-2 text-xs text-terracotta"
              >
                {error.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-line px-4 py-2 text-sm text-cream hover:bg-ink-overlay"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-soft disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Submit report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
