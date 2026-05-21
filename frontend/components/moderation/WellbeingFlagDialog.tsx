"use client";

import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { cn } from "@/components/ui";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useDelayedUnmount } from "@/lib/hooks/useDelayedUnmount";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { useWellbeingFlag } from "@/lib/hooks/useWellbeingFlag";

const formSchema = z.object({
  note: z.string().min(10, "Please add a bit more detail (at least 10 characters)").max(2000),
});

type FormValues = z.infer<typeof formSchema>;

type Props = {
  open: boolean;
  onClose: () => void;
  subjectUid: string;
  subjectName?: string;
  messageId?: string;
  groupId?: string;
};

export function WellbeingFlagDialog({
  open,
  onClose,
  subjectUid,
  subjectName,
  messageId,
  groupId,
}: Props) {
  const noteId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });
  const { submit, submitting, error } = useWellbeingFlag();
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { note: "" },
  });

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    reset({ note: "" });
  }, [open, reset]);

  const { render, state } = useDelayedUnmount(open, 180);
  useBodyScrollLock(open);

  if (!render) return null;

  const onSubmit = async (values: FormValues) => {
    const result = await submit({
      subjectUid,
      note: values.note,
      messageId,
      groupId,
    });
    if (result) {
      setSubmitted(true);
    }
  };

  return (
    <div
      data-state={state}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Dismiss"
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
        aria-labelledby="wellbeing-dialog-title"
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-md rounded-lg bg-ink-raised p-6 shadow-pop outline-none",
          "transition-all duration-base",
          state === "open" ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {submitted ? (
          <div className="space-y-4" data-testid="wellbeing-flag-success">
            <p className="text-body-sm text-cream">
              Thank you. A moderator will reach out within a few days. If this is an emergency
              — someone in immediate danger — please call 911 or 988 (Suicide &amp; Crisis
              Lifeline).
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
          <>
            <h2
              id="wellbeing-dialog-title"
              className="mb-3 text-lg font-semibold text-cream"
            >
              Concerned about this member
              {subjectName ? ` — ${subjectName}` : ""}
            </h2>

            <p className="mb-4 text-sm text-cream-muted">
              This goes only to the moderators (you and the ministry leadership). The person
              you&apos;re flagging will not be told. You&apos;re not getting them in trouble;
              you&apos;re letting people who care reach out.
            </p>

            <form
              onSubmit={(e) => {
                void handleSubmit(onSubmit)(e);
              }}
              className="space-y-4"
              noValidate
            >
              <div>
                <label
                  htmlFor={noteId}
                  className="mb-1 block text-sm font-medium text-cream"
                >
                  What are you noticing?
                </label>
                <textarea
                  id={noteId}
                  rows={5}
                  maxLength={2000}
                  placeholder="Share what you've observed or what's on your heart about this person…"
                  {...register("note")}
                  className="w-full rounded border border-line bg-ink-overlay px-2 py-1 text-sm text-cream placeholder:text-cream-muted focus:outline-none focus-visible:shadow-glow-gold"
                />
                {errors.note && (
                  <p className="mt-1 text-xs text-terracotta">{errors.note.message}</p>
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
                  {submitting ? "Sending…" : "Send to moderators"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
