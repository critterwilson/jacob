"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { humanizeAuthError } from "@/components/auth/error-messages";
import { type SignInValues, signInSchema } from "@/lib/auth-schemas";
import { auth } from "@/lib/firebase";

export function SignInForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      router.push("/");
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
      router.push("/");
    } catch (err) {
      setSubmitError(humanizeAuthError(err));
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4"
      noValidate
      aria-label="Sign in"
    >
      <div>
        <label className="block text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register("email")}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
        {errors.email && (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {errors.email.message}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
        {errors.password && (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {errors.password.message}
          </p>
        )}
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-red-600">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <button
        type="button"
        onClick={onGoogle}
        className="w-full rounded border border-gray-300 px-4 py-2 font-medium"
      >
        Continue with Google
      </button>

      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-blue-600 underline">
          Forgot password?
        </Link>
        <Link href="/sign-up" className="text-blue-600 underline">
          Create an account
        </Link>
      </div>
    </form>
  );
}
