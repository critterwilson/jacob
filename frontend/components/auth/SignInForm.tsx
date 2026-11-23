"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInWithEmailAndPassword } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  signInSchema,
  type SignInValues,
  mapFirebaseAuthError,
} from "@/lib/validation/auth";

export function SignInForm() {
  const router = useRouter();
  const { signInWithGoogle } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: SignInValues) {
    setFormError(null);
    try {
      const cred = await signInWithEmailAndPassword(
        firebaseAuth(),
        values.email,
        values.password,
      );
      if (!cred.user.emailVerified) {
        await firebaseAuth().signOut();
        setFormError(mapFirebaseAuthError("auth/email-not-verified"));
        return;
      }
      router.push("/home");
    } catch (err) {
      const code = (err as { code?: string }).code;
      setFormError(mapFirebaseAuthError(code));
    }
  }

  async function onGoogle() {
    setFormError(null);
    try {
      await signInWithGoogle();
      router.push("/home");
    } catch (err) {
      const code = (err as { code?: string }).code;
      setFormError(mapFirebaseAuthError(code));
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Sign in"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
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
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          {...register("password")}
          className="rounded border border-gray-300 px-3 py-2"
        />
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
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>

      <button
        type="button"
        onClick={onGoogle}
        className="rounded border border-gray-300 px-4 py-2"
      >
        Continue with Google
      </button>

      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="underline">
          Forgot password?
        </Link>
        <Link href="/sign-up" className="underline">
          Create an account
        </Link>
      </div>
    </form>
  );
}
