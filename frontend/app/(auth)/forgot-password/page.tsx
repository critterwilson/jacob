import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { Eyebrow, Heading } from "@/components/ui";

export const metadata = { title: "Reset password — JACOB" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Eyebrow>Reset password</Eyebrow>
        <Heading level={2} size="sm">
          Forgotten your password?
        </Heading>
        <p className="text-body-sm text-cream-muted">
          Enter the email you signed up with and we&rsquo;ll send a link to
          reset it.
        </p>
      </header>
      <ForgotPasswordForm />
    </div>
  );
}
