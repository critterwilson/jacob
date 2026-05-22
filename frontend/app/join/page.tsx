"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const joinSchema = z.object({
  code: z
    .string()
    .min(1, "Invite code is required")
    .max(16, "Code must be 16 characters or less")
    .toUpperCase(),
});

type JoinValues = z.infer<typeof joinSchema>;

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<JoinValues>({ resolver: zodResolver(joinSchema) });

  // Pre-fill code from URL query param
  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      setValue("code", code.toUpperCase());
    }
  }, [searchParams, setValue]);

  useEffect(() => {
    if (!authLoading && !user) {
      const code = searchParams.get("code");
      const dest = code ? `/join?code=${code}` : "/join";
      router.replace(`/sign-in?redirect=${encodeURIComponent(dest)}`);
    }
  }, [user, authLoading, router, searchParams]);

  const onSubmit = async (values: JoinValues) => {
    if (!user) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const { groupId } = await apiPost<{ groupId: string }>(
        "/api/groups/join",
        { code: values.code },
      );
      router.push(`/groups/${groupId}`);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "group_at_cap") {
          setSubmitError(
            "This group has reached its member limit. The group leader can raise the cap to add more members.",
          );
        } else if (e.status === 409) {
          setSubmitError("You are already a member of this group.");
        } else if (e.status === 404) {
          setSubmitError("Invite code not found. Double-check and try again.");
        } else {
          setSubmitError(e.message || "Failed to join group.");
        }
      } else {
        setSubmitError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-sm px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Join a group</h1>
      <p className="mb-8 text-sm text-cream-muted">
        Enter the invite code someone shared with you.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-6"
        noValidate
        aria-label="Join group"
      >
        <div>
          <label className="block text-sm font-medium" htmlFor="code">
            Invite code <span aria-hidden>*</span>
          </label>
          <input
            id="code"
            type="text"
            autoComplete="off"
            spellCheck={false}
            {...register("code")}
            className="mt-1 block w-full rounded border border-line px-3 py-2 font-mono uppercase tracking-widest"
            placeholder="XXXXXXXX"
          />
          {errors.code && (
            <p role="alert" className="mt-1 text-sm text-terracotta">
              {errors.code.message}
            </p>
          )}
        </div>

        {submitError && (
          <p role="alert" className="text-sm text-terracotta">
            {submitError}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end">
          <Button
            type="submit"
            variant="primary"
            fullWidth="mobile"
            loading={submitting}
          >
            {submitting ? "Joining…" : "Join group"}
          </Button>
        </div>
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center">
          <span className="text-sm text-cream-muted">Loading…</span>
        </main>
      }
    >
      <JoinForm />
    </Suspense>
  );
}
