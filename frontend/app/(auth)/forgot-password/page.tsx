import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata = { title: "Reset password — JACOB" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Reset your password</h1>
      <ForgotPasswordForm />
    </>
  );
}
