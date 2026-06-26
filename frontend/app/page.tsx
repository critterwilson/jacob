"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LegalFooter } from "@/components/legal/LegalFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BranchMark } from "@/components/motifs/BranchMark";
import { Button, Heading } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { useAuth } from "@/lib/auth-context";

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      // Land approved members in their groups (the gravity well), not a
      // synthetic dashboard — /home was removed as a destination in the
      // v2 redesign (§7.2) and now just redirects here.
      router.replace("/groups");
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center gap-10 bg-ink px-6 py-16 text-center">
      <BranchMark className="h-32" alt={`${BRAND_NAME} logo`} />

      <div className="space-y-4">
        <Heading level={1} size="xl" className="normal-case">
          {BRAND_NAME}
        </Heading>
        <p className="mx-auto max-w-prose text-body-lg text-cream-muted">
          A quiet place for your small group. Share scripture, pray together,
          and stay close between Sundays.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Button
          variant="primary"
          size="lg"
          onClick={() => router.push("/sign-in")}
        >
          Sign in
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push("/sign-up")}
        >
          Create an account
        </Button>
      </div>

      <div className="flex flex-col items-center gap-4">
        <ThemeToggle />
        <LegalFooter />
      </div>
    </main>
  );
}
