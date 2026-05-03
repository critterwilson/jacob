"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { AppShell } from "@/components/nav/AppShell";
import { PushPrompt } from "@/components/nav/PushPrompt";
import { SearchBar } from "@/components/search/SearchBar";
import { useAuth } from "@/lib/auth-context";
import { usePushSetup } from "@/lib/hooks/usePushSetup";

export default function AuthedLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  usePushSetup(user?.uid ?? null);

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

  return (
    <AppShell>
      <SearchBar />
      {user && (
        <div className="mx-auto max-w-2xl px-4 pt-4">
          <PushPrompt uid={user.uid} />
        </div>
      )}
      {children}
    </AppShell>
  );
}
