"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { AppShell } from "@/components/nav/AppShell";
import { InstallPrompt } from "@/components/nav/InstallPrompt";
import { PushPrompt } from "@/components/nav/PushPrompt";
import { SearchBar } from "@/components/search/SearchBar";
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
        <span className="text-sm text-cream-muted" role="status">
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
        <div className="mx-auto max-w-2xl px-4 pt-4 flex flex-col gap-2">
          <PushPrompt uid={user.uid} />
          <InstallPrompt />
        </div>
      )}
      {children}
    </AppShell>
  );
}
