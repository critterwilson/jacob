"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { AppShell } from "@/components/nav/AppShell";
import { InstallPrompt } from "@/components/nav/InstallPrompt";
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

  // Register service worker (disabled when NEXT_PUBLIC_DISABLE_SW=true).
  useEffect(() => {
    if (
      process.env.NEXT_PUBLIC_DISABLE_SW === "true" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => undefined);
    return () => {
      if (process.env.NEXT_PUBLIC_DISABLE_SW === "true") {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => void r.unregister());
        }).catch(() => undefined);
      }
    };
  }, []);

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
        <div className="mx-auto max-w-2xl px-4 pt-4 flex flex-col gap-2">
          <PushPrompt uid={user.uid} />
          <InstallPrompt />
        </div>
      )}
      {children}
    </AppShell>
  );
}
