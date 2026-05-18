"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LightFromClouds } from "@/components/motifs/LightFromClouds";
import { Banner, Button, Card, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { useMyApplication } from "@/lib/hooks/useMyApplication";

/**
 * ADR 0012 — "your application is being reviewed" gate.
 *
 * The page polls `GET /api/applications/me`:
 *   - status === "pending"  → show the waiting card,
 *   - status === "approved" → push to /groups (the user doc now exists,
 *                            and the bootstrap-cookie will gate the
 *                            middleware-protected routes),
 *   - status === "rejected" → show the rejection card with the admin's
 *                            reason, and offer a sign-out.
 *   - no application doc    → bounce to /onboarding (they haven't
 *                            submitted the form yet).
 */
export default function AwaitingApprovalPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const {
    application,
    loading: applicationLoading,
    error,
    refresh,
  } = useMyApplication({ uid: user?.uid, pollMs: 30_000 });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (applicationLoading) return;
    if (!application) return;
    if (application.status === "approved") {
      router.replace("/groups");
    }
  }, [application, applicationLoading, router]);

  useEffect(() => {
    if (applicationLoading || !user) return;
    // No application doc — they shouldn't be here; the onboarding
    // form is the entry path.
    if (!application && !error) {
      router.replace("/onboarding");
    }
  }, [application, applicationLoading, error, user, router]);

  const onSignOut = async () => {
    await signOut(auth).catch(() => undefined);
    router.replace("/sign-in");
  };

  if (authLoading || applicationLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  if (!user || !application) return null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ink px-4 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-gold-soft">
          <LightFromClouds className="h-20 w-auto opacity-90" />
          <Heading level={1} size="md" className="normal-case">
            JACOB
          </Heading>
        </div>

        {application.status === "pending" && (
          <Card surface="raised" padding="lg" className="w-full space-y-5">
            <header className="space-y-2">
              <Eyebrow>Application submitted</Eyebrow>
              <Heading level={2} size="sm">
                Waiting for approval
              </Heading>
              <p className="text-body-sm text-cream-muted">
                Thanks for applying to JACOB. A ministry admin will review
                your application and approve it before your account becomes
                active.{" "}
                {application.isMinor
                  ? "Because you're under 18, an admin will also confirm your parent or guardian has given consent."
                  : null}
              </p>
              <p className="text-body-sm text-cream-muted">
                You can close this tab and come back any time — when you
                sign in, you&apos;ll land here until your application is decided.
              </p>
            </header>
            <div className="space-y-2">
              <Button
                type="button"
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => void refresh()}
              >
                Check status
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
        )}

        {application.status === "rejected" && (
          <Card surface="raised" padding="lg" className="w-full space-y-5">
            <header className="space-y-2">
              <Eyebrow>Application decided</Eyebrow>
              <Heading level={2} size="sm">
                Your application was not approved
              </Heading>
              <p className="text-body-sm text-cream-muted">
                A ministry admin reviewed your application and was not able
                to approve it at this time.
              </p>
              {application.rejectionReason && (
                <Banner tone="info">
                  <p className="text-body-sm">
                    <strong>Note from the admin:</strong>{" "}
                    {application.rejectionReason}
                  </p>
                </Banner>
              )}
              <p className="text-body-sm text-cream-muted">
                If you have questions, reach out to the ministry directly.
              </p>
            </header>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onSignOut}
            >
              Sign out
            </Button>
          </Card>
        )}

        {application.status === "approved" && (
          // The redirect-effect should already have fired; render a
          // small "redirecting" sliver in case the network is slow.
          <p className="text-body-sm text-cream-muted" role="status">
            Approved — taking you to JACOB…
          </p>
        )}
      </div>
    </main>
  );
}
