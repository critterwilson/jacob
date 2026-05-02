"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { doc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { firestore } from "@/lib/firebase";

const settingsSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  description: z.string().max(500, "Description must be 500 characters or less"),
  isPrivate: z.boolean(),
});

type FormValues = z.infer<typeof settingsSchema>;

type Props = {
  gid: string;
  initialValues: FormValues;
};

export function GroupSettingsForm({ gid, initialValues }: Props) {
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: initialValues,
  });

  const description = watch("description");

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateDoc(doc(firestore, "groups", gid), {
        name: values.name.trim(),
        description: values.description.trim(),
        isPrivate: values.isPrivate,
      });
      setSuccess(true);
    } catch {
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label htmlFor="group-name" className="block text-sm font-medium text-gray-700">
          Group name
        </label>
        <input
          id="group-name"
          {...register("name")}
          maxLength={100}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {errors.name && (
          <p role="alert" className="mt-1 text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="group-description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="group-description"
          {...register("description")}
          maxLength={500}
          rows={3}
          className="mt-1 w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-0.5 text-right text-xs text-gray-400">{description.length}/500</p>
        {errors.description && (
          <p role="alert" className="mt-1 text-xs text-red-600">{errors.description.message}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="group-private"
          type="checkbox"
          {...register("isPrivate")}
          className="h-4 w-4 rounded border-gray-300"
        />
        <label htmlFor="group-private" className="text-sm text-gray-700">
          Private group (invite-only)
        </label>
      </div>

      {success && (
        <p role="status" className="text-sm text-green-600">Settings saved.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={saving || !isDirty}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
