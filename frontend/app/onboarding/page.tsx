"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LightFromClouds } from "@/components/motifs/LightFromClouds";
import { ProfileForm } from "@/components/onboarding/ProfileForm";
import { Card, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useUser } from "@/lib/hooks/useUser";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useUser(user?.uid);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (profile) {
      router.replace("/groups");
    }
  }, [user, profile, authLoading, profileLoading, router]);

  if (authLoading || profileLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;
  if (profile) return null;

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
              Complete your profile
            </Heading>
            <p className="text-body-sm text-cream-muted">
              Tell your group a little about yourself.
            </p>
          </header>
          <ProfileForm uid={user.uid} email={user.email} />
        </Card>
      </div>
    </main>
  );
}
