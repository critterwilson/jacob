import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata = { title: "Sign up — JACOB" };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Create your account</h2>
      <SignUpForm />
    </div>
  );
}
