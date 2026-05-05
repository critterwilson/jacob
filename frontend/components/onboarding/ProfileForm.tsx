"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { deleteUser } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { auth } from "@/lib/firebase";
import { setHasProfileCookie, type UserProfile } from "@/lib/hooks/useUser";

type CreateProfileRequest = {
  displayName: string;
  photoURL: string | null;
  isMinor: boolean;
  phone?: string;
  location?: string;
  faithBackground?: string;
};

const AGE_GROUPS = ["18+", "13-17", "under-13"] as const;
type AgeGroup = (typeof AGE_GROUPS)[number];

export const profileSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(50, "Display name must be 50 characters or less"),
  ageGroup: z.enum(AGE_GROUPS, { error: "Please select your age group" }),
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
  // The backend resolves the email server-side from the verified ID
  // token, so the prop is no longer threaded into the request body.
  // `uid` is still passed through to the photo-upload helper.
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
    watch,
    formState: { errors },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) });

  const ageGroup = watch("ageGroup") as AgeGroup | undefined;

  const handleAgeGroupChange = (value: AgeGroup) => {
    if (value === "under-13") {
      setUnder13Blocked(true);
    }
  };

  const onSubmit = async (values: ProfileValues) => {
    if (values.ageGroup === "under-13") {
      await handleUnder13Deletion();
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const body: CreateProfileRequest = {
        displayName: values.displayName,
        photoURL: photoURL ?? null,
        isMinor: values.ageGroup === "13-17",
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.location ? { location: values.location } : {}),
        ...(values.faithBackground
          ? { faithBackground: values.faithBackground }
          : {}),
      };
      await apiPost<UserProfile, CreateProfileRequest>("/api/users/me", body);
      // Mirror the cookie on this origin so the Next.js middleware lets the
      // /groups navigation through. Backend also Set-Cookies but in
      // cross-origin staging the browser saves it under the API host. (H3)
      setHasProfileCookie(true);
      router.push("/groups");
    } catch (err) {
      if (err instanceof ApiError && err.code === "profile_exists") {
        // User already has a profile — treat like a successful onboard
        // and continue. Avoids a stuck banner if the form is double-submitted.
        setHasProfileCookie(true);
        router.push("/groups");
        return;
      }
      setSubmitError("Something went wrong. Please try again.");
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
      router.push("/sign-in?reason=age");
    }
  };

  if (under13Blocked || ageGroup === "under-13") {
    return (
      <Banner tone="error" title="JACOB requires you to be at least 13.">
        <p>Your account has been removed. No data has been saved.</p>
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

      <fieldset className="space-y-2">
        <legend className="font-sans text-label text-cream">
          Age group
          <span aria-hidden="true" className="ml-1 text-terracotta">
            *
          </span>
        </legend>
        <div className="space-y-2">
          {(["18+", "13-17", "under-13"] as const).map((val) => (
            <label
              key={val}
              className="flex cursor-pointer items-center gap-2 text-body text-cream"
            >
              <input
                type="radio"
                value={val}
                className="h-4 w-4 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
                {...register("ageGroup", {
                  onChange: (e) =>
                    handleAgeGroupChange(e.target.value as AgeGroup),
                })}
              />
              {val === "18+"
                ? "18 or older"
                : val === "13-17"
                  ? "13–17"
                  : "Under 13"}
            </label>
          ))}
        </div>
        {errors.ageGroup && (
          <p role="alert" className="text-body-sm text-terracotta">
            {errors.ageGroup.message}
          </p>
        )}
      </fieldset>

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
        <label className="flex cursor-pointer items-start gap-2 text-body-sm text-cream">
          <input
            id="communityGuidelines"
            type="checkbox"
            className="mt-1 h-4 w-4 accent-gold focus:outline-none focus-visible:shadow-glow-gold"
            {...register("communityGuidelines")}
          />
          <span>
            I agree to the{" "}
            <Link
              href="/about"
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
        {submitting ? "Saving…" : "Complete profile"}
      </Button>
    </form>
  );
}
