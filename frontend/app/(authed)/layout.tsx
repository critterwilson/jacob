"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { AppShell } from "@/components/nav/AppShell";
import { useAuth } from "@/lib/auth-context";

export default function AuthedLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500" role="status">
          Loading…
        </span>
      </div>
    );
  }

  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
