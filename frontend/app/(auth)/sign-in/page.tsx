import { Suspense } from "react";

import { SignInForm } from "@/components/auth/SignInForm";
import { Eyebrow, Heading } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Eyebrow>Welcome back</Eyebrow>
        <Heading level={2} size="sm">
          Sign in
        </Heading>
      </header>
      {/* SignInForm reads `?next=` via useSearchParams, which needs a
       * Suspense boundary so the rest of the page can stay statically
       * pre-rendered. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
