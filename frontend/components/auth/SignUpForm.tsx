"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
} from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { humanizeAuthError } from "@/components/auth/error-messages";
import { Banner, Button, Input, Link } from "@/components/ui";
import { type SignUpValues, signUpSchema } from "@/lib/auth-schemas";
import { BRAND_NAME } from "@/lib/brand";
import { auth } from "@/lib/firebase";
import { stashPendingDob } from "@/lib/pending-application";
import { safeNext } from "@/lib/safe-redirect";

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // `?next=` survives the multi-page signup funnel by being threaded
  // onto the URL of every next hop (verify-email, onboarding). For
  // brand-new applicants the invite-code itself is persisted on the
  // application doc (separate fix), so it survives admin approval; the
  // `next` URL only needs to outlive same-session redirects.
  const next = safeNext(searchParams.get("next"));
  const withNext = (path: string): string =>
    next ? `${path}?next=${encodeURIComponent(next)}` : path;

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) });
  const acceptTerms = watch("acceptTerms");
  const dobField = watch("dob");

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
      // Hand the DOB off to the onboarding form via sessionStorage so
      // the user doesn't have to type it twice. The onboarding form
      // still asks for it explicitly (and pre-fills from this stash)
      // because sessionStorage is per-tab; if the user verifies email
      // in a different tab the field remains required there. ADR 0012 § 6.
      stashPendingDob(values.dob);
      // Email/password signups land on /verify-email until they click the
      // verification link. Google sign-in (below) is already verified by
      // the provider, so it skips this gate.
      router.push(withNext("/verify-email"));
    } catch (err) {
      setSubmitError(humanizeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setSubmitError(null);
    if (!acceptTerms) {
      // The Google flow bypasses the form's submit handler, so the
      // zod gate doesn't fire. Surface the same error inline so a
      // user can't sidestep the ToS check by clicking Google.
      setError("acceptTerms", {
        type: "manual",
        message: "You must agree to the Terms of Service and Privacy Policy",
      });
      return;
    }
    // Google sign-in skips the DOB field at signup time (Google already
    // verified the email, and we don't have a UI flow to mid-popup
    // collect the date). The onboarding form is still authoritative —
    // the user types DOB there and the application is created from it.
    if (dobField) {
      stashPendingDob(dobField);
    }
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.push(withNext("/onboarding"));
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

      <Input
        label="Date of birth"
        type="date"
        autoComplete="bday"
        {...register("dob")}
        helperText={`${BRAND_NAME} requires you to be at least 13.`}
        error={errors.dob?.message}
      />

      <div className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-body-sm text-cream">
          <input
            id="acceptTerms"
            type="checkbox"
            className="mt-0.5 h-5 w-5 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
            {...register("acceptTerms")}
          />
          <span>
            I agree to the{" "}
            <Link
              href="/terms"
              variant="accent"
              target="_blank"
              rel="noreferrer"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              variant="accent"
              target="_blank"
              rel="noreferrer"
            >
              Privacy Policy
            </Link>
            <span aria-hidden="true" className="ml-1 text-terracotta">
              *
            </span>
          </span>
        </label>
        {errors.acceptTerms && (
          <p role="alert" className="text-body-sm text-terracotta">
            {errors.acceptTerms.message}
          </p>
        )}
      </div>

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
        <Link href={withNext("/sign-in")} variant="accent">
          Sign in
        </Link>
      </p>
    </form>
  );
}
