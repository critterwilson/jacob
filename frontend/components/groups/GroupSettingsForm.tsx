"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Banner, Button, Input, Textarea } from "@/components/ui";
import { ApiError, apiPatch } from "@/lib/api";
import type { Group } from "@/lib/hooks/useGroup";

const settingsSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Max 100 characters"),
  description: z.string().max(500, "Max 500 characters"),
  isPrivate: z.boolean(),
});

type FormValues = z.infer<typeof settingsSchema>;

type Props = {
  gid: string;
  group: Group;
};

export function GroupSettingsForm({ gid, group }: Props) {
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: group.name,
      description: group.description ?? "",
      isPrivate: group.isPrivate,
    },
  });

  const description = watch("description");

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    setSaved(false);
    try {
      await apiPatch(`/api/groups/${gid}`, {
        name: values.name.trim(),
        description: values.description.trim(),
        isPrivate: values.isPrivate,
      });
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError("Failed to save settings. Please try again.");
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Input
        label="Group name"
        type="text"
        maxLength={100}
        {...register("name")}
        error={errors.name?.message}
      />

      <div className="space-y-1">
        <Textarea
          label="Description"
          rows={3}
          maxLength={500}
          {...register("description")}
          error={errors.description?.message}
        />
        <p className="text-right text-caption text-cream-dim">
          {(description ?? "").length}/500
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-body-sm text-cream">
        <input
          id="group-private"
          type="checkbox"
          {...register("isPrivate")}
          className="h-4 w-4 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
        />
        Private group
      </label>

      {serverError && <Banner tone="error">{serverError}</Banner>}
      {saved && <Banner tone="success">Settings saved.</Banner>}

      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={isSubmitting}
        disabled={!isDirty || isSubmitting}
      >
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
