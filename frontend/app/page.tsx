"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/home");
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500" role="status">
          Loading…
        </span>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">JACOB</h1>
      <p className="max-w-prose text-gray-600">
        Small-group messaging for Christian communities. Stay connected, share
        encouragement, and grow together.
      </p>
      <div className="flex gap-3">
        <Link
          href="/sign-in"
          className="rounded bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="rounded border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Create an account
        </Link>
      </div>
    </main>
  );
}
