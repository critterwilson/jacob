"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { ProfileForm } from "@/components/onboarding/ProfileForm";
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
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </main>
    );
  }

  if (!user) return null;
  if (profile) return null;

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Complete your profile</h1>
      <p className="mb-8 text-sm text-gray-600">
        Tell your group a little about yourself.
      </p>
      <ProfileForm uid={user.uid} email={user.email} />
    </main>
  );
}
