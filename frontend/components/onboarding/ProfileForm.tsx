"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { deleteUser } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PhotoUpload } from "@/components/onboarding/PhotoUpload";
import { ApiError, apiPost } from "@/lib/api";
import { auth } from "@/lib/firebase";
import type { UserProfile } from "@/lib/hooks/useUser";

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
        ...(values.faithBackground ? { faithBackground: values.faithBackground } : {}),
      };
      await apiPost<UserProfile, CreateProfileRequest>("/api/users/me", body);
      router.push("/groups");
    } catch (err) {
      if (err instanceof ApiError && err.code === "profile_exists") {
        // User already has a profile — treat like a successful onboard
        // and continue. Avoids a stuck banner if the form is double-submitted.
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
      <div className="rounded border border-red-200 bg-red-50 p-6 text-center" role="alert">
        <p className="font-medium text-red-800">
          JACOB requires you to be at least 13.
        </p>
        <p className="mt-2 text-sm text-red-600">
          Your account has been removed. No data has been saved.
        </p>
        <button
          type="button"
          onClick={handleUnder13Deletion}
          className="mt-4 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6"
      noValidate
      aria-label="Complete your profile"
    >
      <div>
        <label className="mb-2 block text-sm font-medium">Profile photo</label>
        <PhotoUpload
          uid={uid}
          onUploadComplete={(url) => {
            setPhotoURL(url);
            setPhotoError(null);
          }}
          onUploadError={setPhotoError}
        />
        {photoError && (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {photoError}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="displayName">
          Display name <span aria-hidden>*</span>
        </label>
        <input
          id="displayName"
          type="text"
          autoComplete="name"
          {...register("displayName")}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
        {errors.displayName && (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {errors.displayName.message}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">
          Age group <span aria-hidden>*</span>
        </legend>
        <div className="mt-2 space-y-2">
          {(["18+", "13-17", "under-13"] as const).map((val) => (
            <label key={val} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                value={val}
                {...register("ageGroup", {
                  onChange: (e) => handleAgeGroupChange(e.target.value as AgeGroup),
                })}
              />
              {val === "18+" ? "18 or older" : val === "13-17" ? "13–17" : "Under 13"}
            </label>
          ))}
        </div>
        {errors.ageGroup && (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {errors.ageGroup.message}
          </p>
        )}
      </fieldset>

      <div>
        <label className="block text-sm font-medium" htmlFor="phone">
          Phone (optional)
        </label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          {...register("phone")}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="location">
          City (optional)
        </label>
        <input
          id="location"
          type="text"
          {...register("location")}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="faithBackground">
          Faith background (optional)
        </label>
        <textarea
          id="faithBackground"
          rows={3}
          {...register("faithBackground")}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div className="flex items-start gap-2">
        <input
          id="communityGuidelines"
          type="checkbox"
          {...register("communityGuidelines")}
          className="mt-0.5"
        />
        <label htmlFor="communityGuidelines" className="text-sm">
          I agree to the{" "}
          <a href="/about" className="text-blue-600 underline" target="_blank" rel="noreferrer">
            community guidelines
          </a>{" "}
          <span aria-hidden>*</span>
        </label>
      </div>
      {errors.communityGuidelines && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {errors.communityGuidelines.message}
        </p>
      )}

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
        {submitting ? "Saving…" : "Complete profile"}
      </button>
    </form>
  );
}
