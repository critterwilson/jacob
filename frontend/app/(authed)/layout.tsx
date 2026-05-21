"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { AppShell } from "@/components/nav/AppShell";
import { InstallPrompt } from "@/components/nav/InstallPrompt";
import { PushPrompt } from "@/components/nav/PushPrompt";
import { SearchBar } from "@/components/search/SearchBar";
import { useAuth } from "@/lib/auth-context";

// Surfaces that need to fill the AppShell main area exactly (chat-style
// layouts). For these we skip the in-page Install/Push banners so the
// composer is never pushed below the visible viewport.
function isFullHeightSurface(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    /^\/groups\/[^/]+\/chat\/?$/.test(pathname) ||
    /^\/discover\/[^/]+\/?$/.test(pathname)
  );
}

export default function AuthedLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const fullHeight = isFullHeightSurface(pathname);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted" role="status">
          Loading…
        </span>
      </div>
    );
  }

  if (!user) return null;

  return (
    <AppShell fullHeight={fullHeight}>
      {/* SearchBar is mounted on every authed route so the mobile
       * header search button (in AppShell) can open it everywhere,
       * and so Cmd-K / Ctrl-K keeps working. It self-renders nothing
       * when closed; placing it here (not in AppShell) keeps test
       * bundles that mount AppShell directly from dragging in the
       * SearchBar tree. */}
      <SearchBar />
      {!fullHeight && user && (
        <div className="mx-auto max-w-2xl px-4 pt-4 flex flex-col gap-2">
          <PushPrompt uid={user.uid} />
          <InstallPrompt />
        </div>
      )}
      {children}
    </AppShell>
  );
}
