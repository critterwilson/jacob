import { SignInForm } from "@/components/auth/SignInForm";

export const metadata = { title: "Sign in — JACOB" };

export default function SignInPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
      <SignInForm />
    </>
  );
}
