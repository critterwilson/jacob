"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  Banner,
  Button,
  Heading,
  Input,
  Link,
  Textarea,
} from "@/components/ui";
import { ApiError, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useUser, type UserProfile } from "@/lib/hooks/useUser";

const profileSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Max 100 characters"),
  phone: z.string().max(20, "Max 20 characters").optional().or(z.literal("")),
  location: z.string().max(100, "Max 100 characters").optional().or(z.literal("")),
  faithBackground: z
    .string()
    .max(500, "Max 500 characters")
    .optional()
    .or(z.literal("")),
});

type FormValues = z.infer<typeof profileSchema>;

type UpdateProfileRequest = {
  displayName?: string;
  phone?: string | null;
  location?: string | null;
  faithBackground?: string | null;
};

function ProfileForm({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: profile.displayName,
      phone: profile.phone ?? "",
      location: profile.location ?? "",
      faithBackground: profile.faithBackground ?? "",
    },
  });

  const faithBackground = watch("faithBackground") ?? "";

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    setSaved(false);
    const body: UpdateProfileRequest = {
      displayName: values.displayName.trim(),
      phone: values.phone?.trim() || null,
      location: values.location?.trim() || null,
      faithBackground: values.faithBackground?.trim() || null,
    };
    try {
      await apiPatch<UserProfile, UpdateProfileRequest>("/api/users/me", body);
      setSaved(true);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError("Failed to save. Please try again.");
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Input
        label="Display name"
        type="text"
        autoComplete="name"
        required
        {...register("displayName")}
        error={errors.displayName?.message}
      />

      <Input
        label="Phone (optional)"
        type="tel"
        autoComplete="tel"
        {...register("phone")}
        error={errors.phone?.message}
      />

      <Input
        label="City (optional)"
        type="text"
        {...register("location")}
        error={errors.location?.message}
      />

      <div className="space-y-1">
        <Textarea
          label="Faith background (optional)"
          rows={3}
          maxLength={500}
          {...register("faithBackground")}
          error={errors.faithBackground?.message}
        />
        <p className="text-right text-caption text-cream-dim">
          {faithBackground.length}/500
        </p>
      </div>

      {serverError && <Banner tone="error">{serverError}</Banner>}
      {saved && <Banner tone="success">Profile saved.</Banner>}

      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={isSubmitting}
        disabled={!isDirty || isSubmitting}
      >
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { profile, loading, refresh } = useUser(user?.uid);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-10">
      <Heading level={1} size="md">
        Settings
      </Heading>

      <section className="space-y-5">
        <Heading level={2} size="sm">
          Profile
        </Heading>
        {profile ? (
          <ProfileForm profile={profile} onSaved={refresh} />
        ) : (
          <p className="text-body-sm text-cream-muted">
            Profile not found. Try signing out and back in.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <Heading level={2} size="sm">
          Account
        </Heading>
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-raised shadow-raise">
          <li>
            <Link
              href="/settings/notifications"
              variant="muted"
              className="block px-4 py-3 text-body text-cream no-underline hover:bg-ink-overlay transition-colors duration-fast"
            >
              Notification settings
            </Link>
          </li>
          <li>
            <Link
              href="/settings/blocked"
              variant="muted"
              className="block px-4 py-3 text-body text-cream no-underline hover:bg-ink-overlay transition-colors duration-fast"
            >
              Blocked users
            </Link>
          </li>
          <li>
            <Link
              href="/settings/export"
              variant="muted"
              className="block px-4 py-3 text-body text-cream no-underline hover:bg-ink-overlay transition-colors duration-fast"
            >
              Export my data
            </Link>
          </li>
          <li>
            <Link
              href="/settings/delete-account"
              variant="muted"
              className="block px-4 py-3 text-body text-terracotta no-underline hover:bg-ink-overlay transition-colors duration-fast"
            >
              Delete account
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
