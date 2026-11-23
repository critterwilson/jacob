import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata = { title: "Forgot password — JACOB" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Reset your password</h2>
      <ForgotPasswordForm />
    </div>
  );
}
