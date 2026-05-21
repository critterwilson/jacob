"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export const createGroupSchema = z.object({
  name: z
    .string()
    .min(1, "Group name is required")
    .max(100, "Name must be 100 characters or less"),
  description: z.string().max(500, "Description must be 500 characters or less").optional(),
  isPrivate: z.boolean(),
});

export type CreateGroupValues = z.infer<typeof createGroupSchema>;

export function CreateGroupForm() {
  const router = useRouter();
  const { user } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateGroupValues>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { isPrivate: false },
  });

  const onSubmit = async (values: CreateGroupValues) => {
    if (!user) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const { groupId } = await apiPost<{ groupId: string }>("/api/groups", {
        name: values.name,
        description: values.description ?? "",
        isPrivate: values.isPrivate,
      });
      router.push(`/groups/${groupId}`);
    } catch (e) {
      setSubmitError(
        e instanceof ApiError
          ? e.message || "Failed to create group. Please try again."
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6"
      noValidate
      aria-label="Create group"
    >
      <div>
        <label className="block text-sm font-medium" htmlFor="name">
          Group name <span aria-hidden>*</span>
        </label>
        <input
          id="name"
          type="text"
          {...register("name")}
          className="mt-1 block w-full rounded border border-line bg-ink-raised px-3 py-2 text-cream placeholder:text-cream-muted focus:outline-none focus-visible:shadow-glow-gold"
          placeholder="e.g. Sunday Morning Study"
        />
        {errors.name && (
          <p role="alert" className="mt-1 text-sm text-terracotta">
            {errors.name.message}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="description">
          Description (optional)
        </label>
        <textarea
          id="description"
          rows={3}
          {...register("description")}
          className="mt-1 block w-full rounded border border-line bg-ink-raised px-3 py-2 text-cream placeholder:text-cream-muted focus:outline-none focus-visible:shadow-glow-gold"
          placeholder="What does your group focus on?"
        />
        {errors.description && (
          <p role="alert" className="mt-1 text-sm text-terracotta">
            {errors.description.message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isPrivate"
          type="checkbox"
          {...register("isPrivate")}
          className="h-4 w-4"
        />
        <label htmlFor="isPrivate" className="text-sm font-medium">
          Private group (invite-only, not discoverable)
        </label>
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-terracotta">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-soft disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create group"}
      </button>
    </form>
  );
}
