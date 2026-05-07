"use client";

import {
  reload,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LightFromClouds } from "@/components/motifs/LightFromClouds";
import { Banner, Button, Card, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";

const POLL_INTERVAL_MS = 5_000;

export default function VerifyEmailPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (user.emailVerified) {
      router.replace("/onboarding");
    }
  }, [user, loading, router]);

  // Poll auth.currentUser.reload() every 5s until emailVerified flips.
  useEffect(() => {
    if (!user || user.emailVerified) return;

    const tick = async () => {
      const current = auth.currentUser;
      if (!current) return;
      try {
        await reload(current);
      } catch {
        // Network blip, etc. Keep polling.
        return;
      }
      if (auth.currentUser?.emailVerified) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        router.replace("/onboarding");
      }
    };

    pollingRef.current = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [user, router]);

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
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ink px-4 py-12">
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
              Click it to continue. This page will refresh automatically.
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
