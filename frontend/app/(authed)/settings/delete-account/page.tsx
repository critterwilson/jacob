"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Banner, Button, Heading, Input } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useDeletionStatus } from "@/lib/hooks/useDeletionStatus";

const ConfirmSchema = z.object({
  confirmation: z.literal("DELETE"),
  keepBody: z.boolean(),
});

type ConfirmFormValues = z.infer<typeof ConfirmSchema>;

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function DeleteAccountPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { pending, finalizeAt, keepBody: pendingKeepBody } =
    useDeletionStatus(user?.uid);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ConfirmFormValues>({
    resolver: zodResolver(ConfirmSchema),
    defaultValues: { confirmation: "DELETE" as const, keepBody: true },
  });

  if (pending && finalizeAt) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <Heading level={1} size="md">
          Account deletion pending
        </Heading>
        <p className="text-body text-cream">
          Your account is scheduled for deletion on{" "}
          <strong className="font-medium text-cream">
            {formatDate(finalizeAt)}
          </strong>
          .
        </p>
        <p className="text-body-sm text-cream-muted">
          {pendingKeepBody
            ? "Your messages will remain readable to other members but show as “[deleted user]”."
            : "Your messages will show as “[deleted user]” and the message text will be cleared."}
        </p>

        {submitError && <Banner tone="error">{submitError}</Banner>}

        <Button
          type="button"
          variant="primary"
          size="md"
          loading={submitting}
          disabled={submitting}
          onClick={async () => {
            if (!user) return;
            setSubmitting(true);
            setSubmitError(null);
            try {
              await apiPost("/api/account/delete/cancel", undefined);
              router.replace("/home");
            } catch (e) {
              setSubmitError(
                e instanceof ApiError
                  ? e.message || `HTTP ${e.status}`
                  : e instanceof Error
                    ? e.message
                    : "Cancel failed",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Cancelling…" : "Cancel deletion"}
        </Button>
      </div>
    );
  }

  const onSubmit = async (values: ConfirmFormValues) => {
    if (!user) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiPost("/api/account/delete", { keepBody: values.keepBody });
      // Backend revoked refresh tokens; sign the client out and bounce home.
      await signOut();
      router.replace("/");
    } catch (e) {
      setSubmitError(
        e instanceof ApiError
          ? e.message || `HTTP ${e.status}`
          : e instanceof Error
            ? e.message
            : "Request failed",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-10">
      <Heading level={1} size="md">
        Delete your account
      </Heading>
      <p className="text-body-sm text-cream-muted">
        After you confirm, your account will be scheduled for deletion in{" "}
        <strong className="font-medium text-cream">14 days</strong>. You can
        sign back in during that window to cancel. After 14 days your profile
        and personal data are permanently removed.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <fieldset className="space-y-3 rounded-lg border border-line bg-ink-raised p-4">
          <legend className="px-1 text-eyebrow uppercase tracking-wider text-cream-dim">
            What about your messages?
          </legend>
          <label className="flex cursor-pointer items-start gap-2 text-body-sm">
            <input
              type="radio"
              value="keep"
              checked={form.watch("keepBody") === true}
              onChange={() => form.setValue("keepBody", true)}
              className="mt-1 h-4 w-4 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
            />
            <span>
              <span className="block font-medium text-cream">
                Keep my messages
              </span>
              <span className="block text-caption text-cream-muted">
                Author will show as “[deleted user]” but the message text stays
                visible to other members. Recommended — keeps group history
                intact.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-body-sm">
            <input
              type="radio"
              value="erase"
              checked={form.watch("keepBody") === false}
              onChange={() => form.setValue("keepBody", false)}
              className="mt-1 h-4 w-4 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
            />
            <span>
              <span className="block font-medium text-cream">
                Also erase the message text
              </span>
              <span className="block text-caption text-cream-muted">
                Message text is cleared on every message you authored.
              </span>
            </span>
          </label>
        </fieldset>

        <Input
          label="Type DELETE to confirm"
          type="text"
          autoComplete="off"
          {...form.register("confirmation")}
          error={
            form.formState.errors.confirmation
              ? "You must type DELETE exactly to confirm."
              : undefined
          }
        />

        {submitError && <Banner tone="error">{submitError}</Banner>}

        <Button
          type="submit"
          variant="destructive"
          size="md"
          loading={submitting}
          disabled={submitting}
        >
          {submitting ? "Submitting…" : "Schedule account deletion"}
        </Button>
      </form>
    </div>
  );
}
