"use client";

import { signOut } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { LightFromClouds } from "@/components/motifs/LightFromClouds";
import { Banner, Button, Card, Eyebrow, Heading } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { useMyApplication } from "@/lib/hooks/useMyApplication";
import { useUser } from "@/lib/hooks/useUser";
import { safeNext } from "@/lib/safe-redirect";

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
function AwaitingApprovalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const {
    application,
    loading: applicationLoading,
    error,
    refresh,
  } = useMyApplication({ uid: user?.uid, pollMs: 30_000 });
  // Bootstrap the profile so the jacob-has-profile cookie is set before we
  // redirect an approved user to /home. Without this, middleware gates /home
  // and bounces them to /onboarding, which then redirects back here, looping.
  const { loading: profileLoading } = useUser(user?.uid);

  // `?next=` is the post-approval destination — typically an invite
  // landing page (`/join?code=…`) preserved from the original sign-in.
  // Fall back to /home so we never strand an approved user.
  const approvedDest = safeNext(searchParams.get("next")) ?? "/home";

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/sign-in");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (applicationLoading || profileLoading) return;
    if (!application) return;
    if (application.status === "approved") {
      router.replace(approvedDest);
    }
  }, [application, applicationLoading, profileLoading, router, approvedDest]);

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

  // For approved users, also wait for bootstrap so the cookie is ready
  // before the redirect fires. Pending/rejected users skip this wait.
  const waitingForBootstrap =
    !!application && application.status === "approved" && profileLoading;

  if (authLoading || applicationLoading || waitingForBootstrap) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-ink">
        <span className="text-body-sm text-cream-muted" role="status">
          Loading…
        </span>
      </main>
    );
  }

  if (!user || !application) return null;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-ink px-4 py-12">
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
                Thanks for applying to JACOB. An organization admin will
                review your application and approve it before your account
                becomes active.{" "}
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
                An organization admin reviewed your application and was not
                able to approve it at this time.
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
                If you have questions, reach out to the organization directly.
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

export default function AwaitingApprovalPage() {
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
      <AwaitingApprovalContent />
    </Suspense>
  );
}
