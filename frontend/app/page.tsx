"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LegalFooter } from "@/components/legal/LegalFooter";
import { Dove } from "@/components/motifs/Dove";
import { Button, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/home");
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
      <Dove className="h-32 w-auto text-gold-soft opacity-90" />

      <div className="space-y-4">
        <Heading level={1} size="xl" className="normal-case">
          JACOB
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

      <LegalFooter />
    </main>
  );
}
