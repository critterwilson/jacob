"use client";

import {
  reload,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { LightFromClouds } from "@/components/motifs/LightFromClouds";
import { Banner, Button, Card, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { useRefetchOnFocus } from "@/lib/hooks/useRefetchOnFocus";
import { safeNext } from "@/lib/safe-redirect";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [recheckState, setRecheckState] = useState<"idle" | "checking">("idle");

  const next = safeNext(searchParams.get("next"));
  const onboardingHref = next
    ? `/onboarding?next=${encodeURIComponent(next)}`
    : "/onboarding";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (user.emailVerified) {
      router.replace(onboardingHref);
    }
  }, [user, loading, router, onboardingHref]);

  // Re-check verification status when:
  //   - the user comes back to this tab after clicking the link in their
  //     email (focus / visibilitychange — handled by useRefetchOnFocus)
  //   - the user clicks the explicit "I clicked the link" button below
  //
  // No interval polling — per the project-wide "no polling outside chat"
  // rule. The realistic flow is: user opens the email in a new tab,
  // clicks the link, the link tab confirms verified, user returns to
  // this tab → focus fires → reload + redirect.
  const recheck = async () => {
    const current = auth.currentUser;
    if (!current) return;
    setRecheckState("checking");
    try {
      await reload(current);
    } catch {
      // Network blip; user can retry.
      setRecheckState("idle");
      return;
    }
    setRecheckState("idle");
    if (auth.currentUser?.emailVerified) {
      router.replace(onboardingHref);
    }
  };

  useRefetchOnFocus(
    () => {
      void recheck();
    },
    { enabled: !!user && !user.emailVerified },
  );

  const onResend = async () => {
    const current = auth.currentUser;
    if (!current) return;
    setResendState("sending");
    try {
      await sendEmailVerification(current);
      setResendState("sent");
    } catch {
      setResendState("error");
    }
  };

  const onSignOut = async () => {
    await signOut(auth).catch(() => undefined);
    router.replace("/sign-in");
  };

  if (loading || !user) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-ink px-4 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-gold-soft">
          <LightFromClouds className="h-20 w-auto opacity-90" />
          <Heading level={1} size="md" className="normal-case">
            JACOB
          </Heading>
        </div>

        <Card surface="raised" padding="lg" className="w-full space-y-5">
          <header className="space-y-2">
            <Eyebrow>One more step</Eyebrow>
            <Heading level={2} size="sm">
              Verify your email
            </Heading>
            <p className="text-body-sm text-cream-muted">
              We sent a verification link to{" "}
              <span className="text-cream">{user.email ?? "your inbox"}</span>.
              Click it, then come back to this tab — we'll pick up the
              verification automatically. If it doesn't, hit{" "}
              <span className="text-cream">"I verified — continue"</span> below.
            </p>
          </header>

          {resendState === "sent" && (
            <Banner tone="success">
              Verification email sent. Check your inbox.
            </Banner>
          )}
          {resendState === "error" && (
            <Banner tone="error">
              Couldn’t send the email. Try again in a moment.
            </Banner>
          )}

          <div className="space-y-2">
            <Button
              type="button"
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => void recheck()}
              loading={recheckState === "checking"}
            >
              {recheckState === "checking"
                ? "Checking…"
                : "I verified — continue"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onResend}
              loading={resendState === "sending"}
            >
              {resendState === "sending"
                ? "Sending…"
                : "Resend verification email"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onSignOut}
            >
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center bg-ink">
          <span className="text-body-sm text-cream-muted" role="status">
            Loading…
          </span>
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
