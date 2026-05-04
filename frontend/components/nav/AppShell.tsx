"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { DeletionBanner } from "@/components/account/DeletionBanner";
import { useAuth } from "@/lib/auth-context";

const navLinks = [
  { href: "/groups", label: "Chats" },
  { href: "/boards", label: "Boards" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1 px-2">
      {navLinks.map(({ href, label }) => (
        <li key={href}>
          <Link
            href={href}
            onClick={onNavigate}
            className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-blue-50 text-blue-700"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SignOutButton({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await signOut();
      onNavigate?.();
      router.replace("/sign-in");
    } catch {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-none flex-col border-r border-gray-200 bg-white md:flex">
        <div className="px-5 py-6">
          <span className="text-lg font-semibold tracking-tight">JACOB</span>
        </div>
        <nav aria-label="Main navigation" className="flex-1">
          <NavLinks />
        </nav>
        <div className="border-t border-gray-200 px-2 py-3">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center border-b border-gray-200 bg-white px-4 py-3 md:hidden">
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav"
            onClick={() => setDrawerOpen(true)}
            className="mr-3 rounded p-1 text-gray-600 hover:bg-gray-100"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-base font-semibold tracking-tight">JACOB</span>
        </header>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/30"
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
            />
            <nav
              id="mobile-nav"
              aria-label="Main navigation"
              className="relative z-50 flex w-64 flex-col bg-white shadow-xl"
            >
              <div className="flex items-center justify-between px-5 py-5">
                <span className="text-base font-semibold tracking-tight">JACOB</span>
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded p-1 text-gray-600 hover:bg-gray-100"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1">
                <NavLinks onNavigate={() => setDrawerOpen(false)} />
              </div>
              <div className="border-t border-gray-200 px-2 py-3">
                <SignOutButton onNavigate={() => setDrawerOpen(false)} />
              </div>
            </nav>
          </div>
        )}

        <DeletionBanner />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
