"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { humanizeAuthError } from "@/components/auth/error-messages";
import { Banner, Button, Input, Link } from "@/components/ui";
import { type SignInValues, signInSchema } from "@/lib/auth-schemas";
import { auth } from "@/lib/firebase";
import { safeNext } from "@/lib/safe-redirect";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const next = safeNext(searchParams.get("next"));
  const postAuthDest = next ?? "/";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema) });

  const onSubmit = async (values: SignInValues) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        values.email,
        values.password,
      );
      if (!cred.user.emailVerified) {
        await signOut(auth);
        setSubmitError(
          "Please verify your email before signing in. Check your inbox.",
        );
        return;
      }
      router.push(postAuthDest);
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
      router.push(postAuthDest);
    } catch (err) {
      setSubmitError(humanizeAuthError(err));
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5"
      noValidate
      aria-label="Sign in"
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
        autoComplete="current-password"
        {...register("password")}
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
          {submitting ? "Signing in…" : "Sign in"}
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

      <div className="flex items-center justify-between text-body-sm">
        <Link href="/forgot-password" variant="muted">
          Forgot password?
        </Link>
        <Link
          href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"}
          variant="muted"
        >
          Create an account
        </Link>
      </div>
    </form>
  );
}
