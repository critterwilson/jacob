"use client";

import { sendEmailVerification } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { humanizeAuthError } from "@/components/auth/error-messages";
import { Banner, Button, Eyebrow, Heading, Link } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

const POLL_INTERVAL_MS = 5_000;

// Interstitial that holds new email/password sign-ups until they click
// the verification link Firebase emailed them. We poll
// `auth.currentUser.reload()` so the page reacts as soon as the user
// confirms in another tab/device — no manual refresh required.
//
// Google sign-up users land here too if the form sends them; their
// `emailVerified` is already true, so the effect bounces straight to
// `/onboarding` without showing the polling state.
export function VerifyEmailInterstitial() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (user.emailVerified) {
      router.replace("/onboarding");
      return;
    }

    let cancelled = false;
    const tick = async () => {
      try {
        await user.reload();
      } catch {
        // Network blip; the next tick will retry. Don't surface to user.
        return;
      }
      if (cancelled) return;
      if (user.emailVerified) {
        router.replace("/onboarding");
      }
    };

    pollRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [user, loading, router]);

  const onResend = async () => {
    if (!user) return;
    setResendNotice(null);
    setResendError(null);
    setResending(true);
    try {
      await sendEmailVerification(user);
      setResendNotice("Verification email sent. Check your inbox.");
    } catch (err) {
      setResendError(humanizeAuthError(err));
    } finally {
      setResending(false);
    }
  };

  if (loading || !user || user.emailVerified) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Eyebrow>One more step</Eyebrow>
        <Heading level={2} size="sm">
          Verify your email
        </Heading>
        <p className="text-body-sm text-cream-muted">
          We sent a verification link to{" "}
          <span className="text-cream">{user.email}</span>. Click the link in
          that email, then come back to this tab — we&apos;ll let you in
          automatically.
        </p>
      </header>

      {resendNotice && <Banner tone="success">{resendNotice}</Banner>}
      {resendError && <Banner tone="error">{resendError}</Banner>}

      <div className="space-y-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          onClick={onResend}
          loading={resending}
        >
          {resending ? "Sending…" : "Resend verification email"}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => signOut().then(() => router.replace("/sign-in"))}
        >
          Sign out
        </Button>
      </div>

      <p className="text-body-sm text-cream-muted">
        Wrong address?{" "}
        <Link href="/sign-up" variant="accent">
          Create a different account
        </Link>
      </p>
    </div>
  );
}
