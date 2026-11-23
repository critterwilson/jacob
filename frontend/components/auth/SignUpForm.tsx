"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  signUpSchema,
  type SignUpValues,
  mapFirebaseAuthError,
} from "@/lib/validation/auth";

export function SignUpForm() {
  const router = useRouter();
  const { signInWithGoogle } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: SignUpValues) {
    setFormError(null);
    try {
      const cred = await createUserWithEmailAndPassword(
        firebaseAuth(),
        values.email,
        values.password,
      );
      await sendEmailVerification(cred.user);
      // Email/password sign-up requires verification before useful access.
      // Sign the freshly created user out so they cannot reach authed routes
      // until they confirm their email.
      await signOut(firebaseAuth());
      setVerificationSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code;
      setFormError(mapFirebaseAuthError(code));
    }
  }

  async function onGoogle() {
    setFormError(null);
    try {
      await signInWithGoogle();
      router.push("/onboarding");
    } catch (err) {
      const code = (err as { code?: string }).code;
      setFormError(mapFirebaseAuthError(code));
    }
  }

  if (verificationSent) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="text-sm">
          We sent a verification link to your email. Click it, then sign in.
        </p>
        <Link href="/sign-in" className="underline text-sm">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Sign up"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="signup-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="signup-email"
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

      <div className="flex flex-col gap-1">
        <label htmlFor="signup-password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          aria-describedby="password-hint"
          {...register("password")}
          className="rounded border border-gray-300 px-3 py-2"
        />
        <p id="password-hint" className="text-xs text-gray-500">
          At least 10 characters, one number, one symbol.
        </p>
        {errors.password && (
          <p role="alert" className="text-sm text-red-600">
            {errors.password.message}
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
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>

      <button
        type="button"
        onClick={onGoogle}
        className="rounded border border-gray-300 px-4 py-2"
      >
        Continue with Google
      </button>

      <div className="text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </div>
    </form>
  );
}
