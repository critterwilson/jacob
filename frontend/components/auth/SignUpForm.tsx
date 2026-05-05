"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { humanizeAuthError } from "@/components/auth/error-messages";
import { Banner, Button, Input, Link } from "@/components/ui";
import { type SignUpValues, signUpSchema } from "@/lib/auth-schemas";
import { auth } from "@/lib/firebase";

export function SignUpForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = async (values: SignUpValues) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        values.email,
        values.password,
      );
      await sendEmailVerification(cred.user);
      router.push("/onboarding");
    } catch (err) {
      setSubmitError(humanizeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setSubmitError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.push("/onboarding");
    } catch (err) {
      setSubmitError(humanizeAuthError(err));
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5"
      noValidate
      aria-label="Create account"
    >
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        {...register("email")}
        error={errors.email?.message}
      />

      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        {...register("password")}
        helperText="At least 10 characters, one number, one symbol."
        error={errors.password?.message}
      />

      {submitError && <Banner tone="error">{submitError}</Banner>}

      <div className="space-y-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
        >
          {submitting ? "Creating account…" : "Create account"}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          fullWidth
          onClick={onGoogle}
        >
          Continue with Google
        </Button>
      </div>

      <p className="text-body-sm text-cream-muted">
        Already have an account?{" "}
        <Link href="/sign-in" variant="accent">
          Sign in
        </Link>
      </p>
    </form>
  );
}
