import { SignInForm } from "@/components/auth/SignInForm";

export const metadata = { title: "Sign in — JACOB" };

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Sign in</h2>
      <SignInForm />
    </div>
  );
}
