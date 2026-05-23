import { Suspense } from "react";

import { SignUpForm } from "@/components/auth/SignUpForm";
import { Eyebrow, Heading } from "@/components/ui";

export const metadata = { title: "Create account — JACOB" };

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Eyebrow>New to JACOB</Eyebrow>
        <Heading level={2} size="sm">
          Create your account
        </Heading>
        <p className="text-body-sm text-cream-muted">
          Stay close to your group. Read scripture, talk together, grow in
          community.
        </p>
      </header>
      {/* SignUpForm reads `?next=` via useSearchParams. */}
      <Suspense fallback={null}>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
