"use client";

import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button, cn } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useDelayedUnmount } from "@/lib/hooks/useDelayedUnmount";
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

  // Smooth mount/unmount: keep the dialog in the DOM ~180 ms after
  // close so the backdrop fade and dialog scale-in transitions can
  // play. Body scroll is locked while open.
  const { render, state } = useDelayedUnmount(open, 180);
  useBodyScrollLock(open);

  if (!render) return null;

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
    <div
      data-state={state}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Dismiss report dialog"
        onClick={onClose}
        className={cn(
          "fixed inset-0 cursor-default bg-black/40 transition-opacity duration-base",
          "focus:outline-none focus-visible:shadow-glow-gold",
          state === "open" ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-md rounded-lg bg-ink-raised p-6 shadow-pop outline-none",
          "transition-all duration-base",
          state === "open"
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0",
        )}
      >
        <h2 id="report-dialog-title" className="mb-1 text-lg font-semibold">
          Report this {resourceType}
        </h2>
        <p className="mb-4 text-sm text-cream-muted">
          {`Reports go to ${BRAND_NAME}'s moderation team. We review every report.`}
        </p>

        {success ? (
          <div className="space-y-4" data-testid="report-success">
            <p className="rounded bg-sage/15 p-3 text-sm text-sage">
              {success.dedup
                ? "Thanks — we already have this report on file."
                : "Thanks — your report has been sent for review."}
            </p>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="primary"
                fullWidth="mobile"
                onClick={onClose}
              >
                Close
              </Button>
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

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button
                type="button"
                variant="secondary"
                fullWidth="mobile"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                fullWidth="mobile"
                loading={submitting}
              >
                {submitting ? "Sending…" : "Submit report"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
