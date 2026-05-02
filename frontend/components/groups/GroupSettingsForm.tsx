"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { doc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { firestore } from "@/lib/firebase";
import type { Group } from "@/lib/hooks/useGroups";

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
      await updateDoc(doc(firestore, "groups", gid), {
        name: values.name.trim(),
        description: values.description.trim(),
        isPrivate: values.isPrivate,
      });
      setSaved(true);
    } catch {
      setServerError("Failed to save settings. Please try again.");
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
          type="text"
          {...register("name")}
          maxLength={100}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {errors.name && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {errors.name.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="group-description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="group-description"
          {...register("description")}
          rows={3}
          maxLength={500}
          className="mt-1 block w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-0.5 text-right text-xs text-gray-400">
          {(description ?? "").length}/500
        </p>
        {errors.description && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {errors.description.message}
          </p>
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
          Private group
        </label>
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-red-600">
          {serverError}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-600">
          Settings saved.
        </p>
      )}

      <button
        type="submit"
        disabled={!isDirty || isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isSubmitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
