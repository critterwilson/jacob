"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { sendPasswordResetEmail } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
  mapFirebaseAuthError,
} from "@/lib/validation/auth";

export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setFormError(null);
    try {
      await sendPasswordResetEmail(firebaseAuth(), values.email);
      setSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Firebase returns user-not-found here too. Treat all errors as success
      // to avoid leaking which emails are registered, EXCEPT for clearly
      // user-correctable input errors.
      if (code === "auth/invalid-email") {
        setFormError(mapFirebaseAuthError(code));
        return;
      }
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="text-sm">
          If an account exists for that email, we sent a reset link.
        </p>
        <Link href="/sign-in" className="underline text-sm">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Forgot password"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="reset-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...register("email")}
          className="rounded border border-gray-300 px-3 py-2"
        />
        {errors.email && (
          <p role="alert" className="text-sm text-red-600">
            {errors.email.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {isSubmitting ? "Sending…" : "Send reset link"}
      </button>

      <Link href="/sign-in" className="text-sm underline">
        Back to sign in
      </Link>
    </form>
  );
}
