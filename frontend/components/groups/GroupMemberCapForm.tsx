"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Banner, Button, Input } from "@/components/ui";
import { ApiError, apiPatch } from "@/lib/api";

const DEFAULT_CAP = 20;

const capSchema = z.object({
  memberCap: z
    .number({ invalid_type_error: "Enter a whole number" })
    .int("Must be a whole number")
    .min(1, "Cap must be at least 1"),
});

type FormValues = z.infer<typeof capSchema>;

type Props = {
  gid: string;
  currentCap: number | null;
  memberCount: number;
};

type CapResponse = { gid: string; memberCap: number };

export function GroupMemberCapForm({ gid, currentCap, memberCount }: Props) {
  const effectiveCap = currentCap ?? DEFAULT_CAP;
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(capSchema),
    defaultValues: { memberCap: effectiveCap },
  });

  const onSubmit = async (values: FormValues) => {
    setSaved(false);
    setServerError(null);
    try {
      await apiPatch<CapResponse>(`/api/groups/${gid}/cap`, {
        memberCap: values.memberCap,
      });
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError("Failed to update member cap. Please try again.");
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <p className="text-body-sm text-cream-muted">
        Groups are capped at {DEFAULT_CAP} members by default. Raise the cap here
        if your group needs to grow beyond that. The current membership is{" "}
        <strong className="text-cream">{memberCount}</strong>.
      </p>

      <Input
        label="Member cap"
        type="number"
        min={Math.max(1, memberCount)}
        {...register("memberCap", { valueAsNumber: true })}
        error={errors.memberCap?.message}
      />

      {serverError && <Banner tone="error">{serverError}</Banner>}
      {saved && <Banner tone="success">Member cap updated.</Banner>}

      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={isSubmitting}
        disabled={!isDirty || isSubmitting}
      >
        {isSubmitting ? "Saving…" : "Save cap"}
      </Button>
    </form>
  );
}
