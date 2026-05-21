"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { deleteUser } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PhotoUpload } from "@/components/onboarding/PhotoUpload";
import {
  Banner,
  Button,
  Input,
  Link,
  Textarea,
} from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { MIN_AGE, computeAge, dobSchema } from "@/lib/auth-schemas";
import { auth } from "@/lib/firebase";
import { clearPendingDob, readPendingDob } from "@/lib/pending-application";

type SubmitApplicationRequest = {
  displayName: string;
  dob: string;
  photoURL: HttpUrlString | null;
  phone?: string;
  location?: string;
  faithBackground?: string;
};

type HttpUrlString = string;

export const profileSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(50, "Display name must be 50 characters or less"),
  dob: dobSchema,
  communityGuidelines: z.literal(true, {
    error: "You must agree to the community guidelines",
  }),
  phone: z.string().max(20).optional(),
  location: z.string().max(100).optional(),
  faithBackground: z.string().max(500).optional(),
});

export type ProfileValues = z.infer<typeof profileSchema>;

type ProfileFormProps = {
  uid: string;
  email: string | null;
};

export function ProfileForm({ uid, email: _email }: ProfileFormProps) {
  void _email;
  const router = useRouter();
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [under13Blocked, setUnder13Blocked] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) });

  // Pre-fill DOB from the signup stash if present. Best-effort; the
  // user can still edit it. See ADR 0012 § 6 + `lib/pending-application.ts`.
  useEffect(() => {
    const stashed = readPendingDob();
    if (stashed) {
      setValue("dob", stashed, { shouldValidate: false });
    }
  }, [setValue]);

  const onSubmit = async (values: ProfileValues) => {
    const dob = new Date(`${values.dob}T00:00:00Z`);
    if (!Number.isNaN(dob.getTime()) && computeAge(dob) < MIN_AGE) {
      setUnder13Blocked(true);
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const body: SubmitApplicationRequest = {
        displayName: values.displayName,
        dob: values.dob,
        photoURL: photoURL ?? null,
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.location ? { location: values.location } : {}),
        ...(values.faithBackground
          ? { faithBackground: values.faithBackground }
          : {}),
      };
      await apiPost("/api/applications/me", body);
      clearPendingDob();
      router.push("/awaiting-approval");
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_approved") {
        // Race: an admin approved while the user was filling the form,
        // or this caller already has a user doc. Skip straight to the app.
        router.push("/groups");
        return;
      }
      if (err instanceof ApiError && err.code === "application_decided") {
        // The application is already in a decided state — the
        // /awaiting-approval screen will show the rejection or push to
        // /groups. Route there and let it figure out the rest.
        router.push("/awaiting-approval");
        return;
      }
      if (err instanceof ApiError && err.code === "under_minimum_age") {
        setUnder13Blocked(true);
        return;
      }
      if (err instanceof ApiError) {
        setSubmitError(`${err.code} — ${err.message}`);
      } else {
        setSubmitError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnder13Deletion = async () => {
    try {
      if (auth.currentUser) {
        await deleteUser(auth.currentUser);
      }
    } finally {
      clearPendingDob();
      router.push("/sign-in?reason=age");
    }
  };

  if (under13Blocked) {
    return (
      <Banner tone="error" title="JACOB requires you to be at least 13.">
        <p>
          We&rsquo;re unable to create an account for users under 13. Clicking
          Continue will permanently delete your account — this cannot be undone.
        </p>
        <div className="mt-4">
          <Button
            type="button"
            variant="destructive"
            onClick={handleUnder13Deletion}
          >
            Continue
          </Button>
        </div>
      </Banner>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6"
      noValidate
      aria-label="Complete your profile"
    >
      <div className="space-y-2">
        <span className="font-sans text-label text-cream">Profile photo</span>
        <PhotoUpload
          uid={uid}
          onUploadComplete={(url) => {
            setPhotoURL(url);
            setPhotoError(null);
          }}
          onUploadError={setPhotoError}
        />
        {photoError && (
          <p role="alert" className="text-body-sm text-terracotta">
            {photoError}
          </p>
        )}
      </div>

      <Input
        label="Display name"
        type="text"
        autoComplete="name"
        required
        {...register("displayName")}
        error={errors.displayName?.message}
      />

      <Input
        label="Date of birth"
        type="date"
        autoComplete="bday"
        required
        {...register("dob")}
        helperText="JACOB requires you to be at least 13. Applicants under 18 need parental consent — an admin will confirm this before your account is approved."
        error={errors.dob?.message}
      />

      <Input
        label="Phone (optional)"
        type="tel"
        autoComplete="tel"
        {...register("phone")}
      />

      <Input
        label="City (optional)"
        type="text"
        {...register("location")}
      />

      <Textarea
        label="Faith background (optional)"
        rows={3}
        {...register("faithBackground")}
      />

      <div className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-body-sm text-cream">
          <input
            id="communityGuidelines"
            type="checkbox"
            className="mt-0.5 h-5 w-5 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
            {...register("communityGuidelines")}
          />
          <span>
            I agree to the{" "}
            <Link
              href="/guidelines"
              variant="accent"
              target="_blank"
              rel="noreferrer"
            >
              community guidelines
            </Link>
            <span aria-hidden="true" className="ml-1 text-terracotta">
              *
            </span>
          </span>
        </label>
        {errors.communityGuidelines && (
          <p role="alert" className="text-body-sm text-terracotta">
            {errors.communityGuidelines.message}
          </p>
        )}
      </div>

      {submitError && <Banner tone="error">{submitError}</Banner>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={submitting}
      >
        {submitting ? "Submitting application…" : "Submit application"}
      </Button>
    </form>
  );
}
