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
  cn,
} from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { MIN_AGE, computeAge, dobSchema } from "@/lib/auth-schemas";
import { BRAND_NAME } from "@/lib/brand";
import { auth } from "@/lib/firebase";
import {
  clearPendingDob,
  clearPendingInviteCode,
  readPendingDob,
  readPendingInviteCode,
} from "@/lib/pending-application";

// ADR 0015: onboarding writes the user doc directly via POST /api/users/me.
// The legacy applications collection is retired; the request shape mirrors
// the backend `CreateProfileRequest` model.
type CreateProfileRequest = {
  displayName: string;
  dob: string;
  photoURL: HttpUrlString | null;
  phone?: string;
  location?: string;
  faithBackground?: string;
  inviteCode?: string;
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

const TOTAL_STEPS = 2;

export function ProfileForm({ uid, email: _email }: ProfileFormProps) {
  void _email;
  const router = useRouter();
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [under13Blocked, setUnder13Blocked] = useState(false);
  // Step 1: profile fields (required + optional). Step 2: agree + submit.
  // Kept light — splitting the optional fields into their own skip-able
  // step felt like overhead for six fields; merged them into step 1.
  const [step, setStep] = useState<1 | 2>(1);

  const {
    register,
    handleSubmit,
    setValue,
    trigger,
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

  const goToStep2 = async () => {
    const ok = await trigger(["displayName", "dob"]);
    if (!ok) return;
    setStep(2);
  };

  const onSubmit = async (values: ProfileValues) => {
    const dob = new Date(`${values.dob}T00:00:00Z`);
    if (!Number.isNaN(dob.getTime()) && computeAge(dob) < MIN_AGE) {
      setUnder13Blocked(true);
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      // If the user arrived via `/join?code=…` before signing up, the
      // code is stashed in sessionStorage. The onboarding endpoint
      // auto-joins adults into the target group on success; for minors
      // it escalates a pending join-request to the owner queue.
      const pendingInvite = readPendingInviteCode();
      const body: CreateProfileRequest = {
        displayName: values.displayName,
        dob: values.dob,
        photoURL: photoURL ?? null,
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.location ? { location: values.location } : {}),
        ...(values.faithBackground
          ? { faithBackground: values.faithBackground }
          : {}),
        ...(pendingInvite ? { inviteCode: pendingInvite } : {}),
      };
      await apiPost("/api/users/me", body);
      clearPendingDob();
      clearPendingInviteCode();
      // ADR 0015: new users land "unaffiliated" — no platform-wide
      // approval queue. Send them to /home which renders the
      // unaffiliated banner pointing at /discover.
      router.push("/home");
    } catch (err) {
      if (err instanceof ApiError && err.code === "profile_exists") {
        // Race: this caller already has a user doc. Skip to the app.
        router.push("/home");
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
      clearPendingInviteCode();
      router.push("/sign-in?reason=age");
    }
  };

  if (under13Blocked) {
    return (
      <Banner
        tone="error"
        title={`${BRAND_NAME} requires you to be at least 13.`}
      >
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
      <ProgressIndicator step={step} total={TOTAL_STEPS} />

      {/* Step 1: profile fields. Step 2 keeps these in the form state via
       * react-hook-form but they're not rendered, so a fresh mount can't
       * read them — that's fine, we only Submit from step 2. */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="space-y-2">
            <span className="font-sans text-label text-cream">
              Profile photo
            </span>
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
            helperText={`${BRAND_NAME} requires you to be at least 13. Applicants under 18 need a ministry owner to confirm parental consent before they can join a group.`}
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

          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => void goToStep2()}
          >
            Continue
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <p className="text-body-sm text-cream-muted">
            {`Last step — agree to ${BRAND_NAME}'s community guidelines to finish creating your account.`}
          </p>

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

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => setStep(1)}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
            >
              {submitting ? "Creating your account…" : "Create account"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function ProgressIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      <p className="text-caption text-cream-muted">
        Step {step} of {total}
      </p>
      <div className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-base",
              n <= step ? "bg-gold" : "bg-line",
            )}
          />
        ))}
      </div>
    </div>
  );
}
