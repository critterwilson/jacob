"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAuth } from "@/lib/auth-context";
import { useDeletionStatus } from "@/lib/hooks/useDeletionStatus";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
  const { pending, finalizeAt, keepBody: pendingKeepBody } = useDeletionStatus(
    user?.uid,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ConfirmFormValues>({
    resolver: zodResolver(ConfirmSchema),
    defaultValues: { confirmation: "DELETE" as const, keepBody: true },
  });

  if (pending && finalizeAt) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <h1 className="mb-4 text-2xl font-semibold">Account deletion pending</h1>
        <p className="mb-2 text-sm text-gray-700">
          Your account is scheduled for deletion on{" "}
          <strong>{formatDate(finalizeAt)}</strong>.
        </p>
        <p className="mb-6 text-sm text-gray-600">
          {pendingKeepBody
            ? "Your messages will remain readable to other members but show as “[deleted user]”."
            : "Your messages will show as “[deleted user]” and the message text will be cleared."}
        </p>

        {submitError && (
          <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
            {submitError}
          </p>
        )}

        <button
          type="button"
          disabled={submitting}
          onClick={async () => {
            if (!user) return;
            setSubmitting(true);
            setSubmitError(null);
            try {
              const token = await user.getIdToken();
              const res = await fetch(`${API}/api/account/delete/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              router.replace("/home");
            } catch (e) {
              setSubmitError(
                e instanceof Error ? e.message : "Cancel failed",
              );
            } finally {
              setSubmitting(false);
            }
          }}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Cancelling…" : "Cancel deletion"}
        </button>
      </div>
    );
  }

  const onSubmit = async (values: ConfirmFormValues) => {
    if (!user) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API}/api/account/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ keepBody: values.keepBody }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Backend revoked refresh tokens; sign the client out and bounce home.
      await signOut();
      router.replace("/");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Request failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Delete your account</h1>
      <p className="mb-6 text-sm text-gray-700">
        After you confirm, your account will be scheduled for deletion in{" "}
        <strong>14 days</strong>. You can sign back in during that window to
        cancel. After 14 days your profile and personal data are permanently
        removed.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <fieldset className="space-y-2 rounded border border-gray-200 p-3 text-sm">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            What about your messages?
          </legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              value="keep"
              checked={form.watch("keepBody") === true}
              onChange={() => form.setValue("keepBody", true)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Keep my messages</span>
              <span className="block text-xs text-gray-500">
                Author will show as “[deleted user]” but the message text stays
                visible to other members. Recommended — keeps group history
                intact.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              value="erase"
              checked={form.watch("keepBody") === false}
              onChange={() => form.setValue("keepBody", false)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Also erase the message text</span>
              <span className="block text-xs text-gray-500">
                Message text is cleared on every message you authored.
              </span>
            </span>
          </label>
        </fieldset>

        <div>
          <label
            htmlFor="confirmation"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Type <code className="rounded bg-gray-100 px-1">DELETE</code> to
            confirm
          </label>
          <input
            id="confirmation"
            type="text"
            autoComplete="off"
            {...form.register("confirmation")}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          {form.formState.errors.confirmation && (
            <p className="mt-1 text-xs text-red-600">
              You must type DELETE exactly to confirm.
            </p>
          )}
        </div>

        {submitError && (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700">
            {submitError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Schedule account deletion"}
        </button>
      </form>
    </div>
  );
}
