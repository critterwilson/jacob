"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { BranchMark } from "@/components/motifs/BranchMark";
import { ProfileForm } from "@/components/onboarding/ProfileForm";
import { Card, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { BRAND_NAME } from "@/lib/brand";
import { useUser } from "@/lib/hooks/useUser";
import { safeNext } from "@/lib/safe-redirect";

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useUser(user?.uid);

  // `?next=` carries the intended post-auth destination (typically an
  // invite landing). For users who already have a profile we forward
  // them there instead of /home.
  const next = safeNext(searchParams.get("next"));
  const approvedDest = next ?? "/home";

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (profile) {
      router.replace(approvedDest);
    }
  }, [user, profile, authLoading, profileLoading, router, approvedDest]);

  if (authLoading || profileLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;
  if (profile) return null;

  return (
    <main className="flex min-h-svh flex-col items-center bg-ink px-4 py-12 pt-safe-t pb-safe-b">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <BranchMark className="h-16" />
          <Heading level={1} size="md" className="normal-case">
            {BRAND_NAME}
          </Heading>
        </div>

        <Card surface="raised" padding="lg" className="w-full space-y-6">
          <header className="space-y-2">
            <Eyebrow>{`Welcome to ${BRAND_NAME}`}</Eyebrow>
            <Heading level={2} size="sm">
              Set up your profile
            </Heading>
            <p className="text-body-sm text-cream-muted">
              Tell us a little about yourself. You&rsquo;ll be able to discover
              and request to join groups as soon as you&rsquo;re finished.
            </p>
          </header>
          <ProfileForm uid={user.uid} email={user.email} />
        </Card>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center bg-ink">
          <span className="text-body-sm text-cream-muted">Loading…</span>
        </main>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
