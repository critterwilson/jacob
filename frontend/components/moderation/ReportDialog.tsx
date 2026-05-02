"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
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

  // Close on Escape and reset state when re-opening.
  useEffect(() => {
    if (!open) return;
    setSuccess(null);
    reset({ reason: "harassment", context: "" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, reset]);

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
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl outline-none"
      >
        <h2 id="report-dialog-title" className="mb-1 text-lg font-semibold">
          Report this {resourceType}
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          Reports go to JACOB&apos;s moderation team. We review every report.
        </p>

        {success ? (
          <div className="space-y-4" data-testid="report-success">
            <p className="rounded bg-green-50 p-3 text-sm text-green-800">
              {success.dedup
                ? "Thanks — we already have this report on file."
                : "Thanks — your report has been sent for review."}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
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
                className="mb-1 block text-sm font-medium text-gray-800"
              >
                Reason
              </label>
              <select
                id={reasonId}
                {...register("reason")}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {reasonOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {errors.reason && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.reason.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={contextId}
                className="mb-1 block text-sm font-medium text-gray-800"
              >
                Add context (optional, max 500 chars)
              </label>
              <textarea
                id={contextId}
                rows={4}
                maxLength={500}
                {...register("context")}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.context && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.context.message}
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded bg-red-50 p-2 text-xs text-red-700"
              >
                {error.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-gray-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
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
