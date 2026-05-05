"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { DeletionBanner } from "@/components/account/DeletionBanner";
import { Heading, Link, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

const navLinks = [
  { href: "/groups", label: "Chats" },
  { href: "/boards", label: "Boards" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
];

function Wordmark({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <Heading
      level={2}
      size={size}
      className={cn("normal-case tracking-tight", size === "sm" && "leading-none")}
    >
      JACOB
    </Heading>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1 px-2">
      {navLinks.map(({ href, label }) => {
        const active =
          pathname === href || pathname.startsWith(href + "/");
        return (
          <li key={href}>
            <Link
              href={href}
              variant="muted"
              onClick={onNavigate}
              className={cn(
                "block rounded-md py-2 pl-[10px] pr-3 font-sans text-label no-underline " +
                  "transition-colors duration-fast",
                "border-l-2",
                active
                  ? "border-gold bg-ink-raised text-cream hover:text-cream"
                  : "border-transparent hover:bg-ink-raised hover:text-cream",
              )}
            >
              {label}
            </Link>
          </li>
        );
      })}
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
      className={
        "block w-full rounded-md px-3 py-2 text-left font-sans text-label " +
        "text-cream-muted transition-colors duration-fast " +
        "hover:bg-ink-raised hover:text-cream " +
        "focus:outline-none focus-visible:shadow-glow-gold " +
        "disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

function HamburgerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-ink text-cream">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-none flex-col border-r border-line bg-ink md:flex">
        <div className="px-5 py-6">
          <Wordmark size="sm" />
        </div>
        <nav aria-label="Main navigation" className="flex-1">
          <NavLinks />
        </nav>
        <div className="border-t border-line px-2 py-3">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center border-b border-line bg-ink px-4 py-3 md:hidden">
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav"
            onClick={() => setDrawerOpen(true)}
            className={
              "mr-3 rounded p-1 text-cream-muted " +
              "hover:bg-ink-raised hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
            }
          >
            <HamburgerIcon />
          </button>
          <Wordmark size="sm" />
        </header>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/60"
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
            />
            <nav
              id="mobile-nav"
              aria-label="Main navigation"
              className="relative z-50 flex w-64 flex-col bg-ink-raised shadow-pop"
            >
              <div className="flex items-center justify-between px-5 py-5">
                <Wordmark size="sm" />
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  onClick={() => setDrawerOpen(false)}
                  className={
                    "rounded p-1 text-cream-muted " +
                    "hover:bg-ink hover:text-cream " +
                    "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
                  }
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="flex-1">
                <NavLinks onNavigate={() => setDrawerOpen(false)} />
              </div>
              <div className="border-t border-line px-2 py-3">
                <SignOutButton onNavigate={() => setDrawerOpen(false)} />
              </div>
            </nav>
          </div>
        )}

        <DeletionBanner />
        <main className="flex-1 overflow-y-auto bg-ink">{children}</main>
      </div>
    </div>
  );
}
