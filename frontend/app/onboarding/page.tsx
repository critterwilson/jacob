"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LightFromClouds } from "@/components/motifs/LightFromClouds";
import { ProfileForm } from "@/components/onboarding/ProfileForm";
import { Card, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useMyApplication } from "@/lib/hooks/useMyApplication";
import { useUser } from "@/lib/hooks/useUser";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useUser(user?.uid);
  // ADR 0012: an applicant who has already submitted the application
  // form lives in `applications/{uid}`. If we land here with a pending
  // or decided application, bounce them to /awaiting-approval — re-
  // filling the form would be confusing.
  const { application, loading: applicationLoading } = useMyApplication({
    uid: user?.uid,
    pollMs: 60_000,
  });

  useEffect(() => {
    if (authLoading || profileLoading || applicationLoading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (profile) {
      router.replace("/home");
      return;
    }
    if (application) {
      router.replace("/awaiting-approval");
    }
  }, [
    user,
    profile,
    application,
    authLoading,
    profileLoading,
    applicationLoading,
    router,
  ]);

  if (authLoading || profileLoading || applicationLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;
  if (profile) return null;
  if (application) return null;

  return (
    <main className="flex min-h-screen flex-col items-center bg-ink px-4 py-12">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-gold-soft">
          <LightFromClouds className="h-16 w-auto opacity-90" />
          <Heading level={1} size="md" className="normal-case">
            JACOB
          </Heading>
        </div>

        <Card surface="raised" padding="lg" className="w-full space-y-6">
          <header className="space-y-2">
            <Eyebrow>One last step</Eyebrow>
            <Heading level={2} size="sm">
              Apply to join
            </Heading>
            <p className="text-body-sm text-cream-muted">
              Tell us a little about yourself. An admin will review your
              application before your account is approved.
            </p>
          </header>
          <ProfileForm uid={user.uid} email={user.email} />
        </Card>
      </div>
    </main>
  );
}
