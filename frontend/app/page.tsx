"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { user, loading, signOut } = useAuth();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold">JACOB</h1>
      <p className="max-w-prose text-gray-600">
        Small-group messaging for Christian communities.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500" role="status">
          Loading…
        </p>
      ) : user ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm">Signed in as {user.email ?? user.uid}.</p>
          <div className="flex gap-3">
            <Link
              href="/home"
              className="rounded bg-blue-600 px-4 py-2 text-white"
            >
              Go to your home
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded border border-gray-300 px-4 py-2"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <Link
            href="/sign-in"
            className="rounded bg-blue-600 px-4 py-2 text-white"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded border border-gray-300 px-4 py-2"
          >
            Create an account
          </Link>
        </div>
      )}
    </main>
  );
}
