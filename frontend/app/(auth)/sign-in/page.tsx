import { SignInForm } from "@/components/auth/SignInForm";
import { Eyebrow, Heading } from "@/components/ui";

export const metadata = { title: "Sign in — JACOB" };

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Eyebrow>Welcome back</Eyebrow>
        <Heading level={2} size="sm">
          Sign in
        </Heading>
      </header>
      <SignInForm />
    </div>
  );
}
