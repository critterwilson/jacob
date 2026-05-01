import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata = { title: "Create account — JACOB" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Create your account</h1>
      <SignUpForm />
    </>
  );
}
