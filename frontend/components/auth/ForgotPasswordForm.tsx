"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendPasswordResetEmail } from "firebase/auth";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { humanizeAuthError } from "@/components/auth/error-messages";
import { Banner, Button, Input, Link } from "@/components/ui";
import {
  type ForgotPasswordValues,
  forgotPasswordSchema,
} from "@/lib/auth-schemas";
import { auth } from "@/lib/firebase";

export function ForgotPasswordForm() {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (values: ForgotPasswordValues) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, values.email);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(humanizeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="space-y-4">
        <Banner tone="success" title="Check your inbox">
          If that email is registered, a password-reset link is on its way.
        </Banner>
        <Link href="/sign-in" variant="muted" className="block">
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5"
      noValidate
      aria-label="Forgot password"
    >
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        {...register("email")}
        error={errors.email?.message}
      />

      {submitError && <Banner tone="error">{submitError}</Banner>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={submitting}
      >
        {submitting ? "Sending…" : "Send reset link"}
      </Button>

      <Link href="/sign-in" variant="muted" className="block text-center">
        ← Back to sign in
      </Link>
    </form>
  );
}
