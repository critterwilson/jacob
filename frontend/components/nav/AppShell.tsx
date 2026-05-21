"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { DeletionBanner } from "@/components/account/DeletionBanner";
import { Heading, Link, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

// The mobile search button dispatches this event; SearchBar (mounted by
// AuthedLayout) listens for it. Going through window means AppShell
// doesn't need to import SearchBar — that kept several test bundles
// lean and avoided dragging useSearch into every AppShell mount.
function dispatchOpenSearch() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("jacob:open-search"));
  }
}

const navLinks = [
  { href: "/feed", label: "Feed" },
  { href: "/groups", label: "Chats" },
  { href: "/boards", label: "Boards" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/settings", label: "Settings" },
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
                "flex min-h-11 items-center rounded-md py-2 pl-[10px] pr-3 font-sans text-label no-underline " +
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
        "flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left font-sans text-label " +
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

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function AppShell({
  children,
  fullHeight = false,
}: {
  children: ReactNode;
  /**
   * When true, the page is expected to be a fixed-height surface
   * (e.g. chat) that fills the AppShell main area. The outer column
   * stops scrolling — children that need to scroll declare it
   * themselves — and `<main>` has overflow-hidden so nested scroll
   * containers don't double up.
   */
  fullHeight?: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);
  const drawerRef = useFocusTrap<HTMLDivElement>({
    active: drawerOpen,
    onEscape: closeDrawer,
  });
  useBodyScrollLock(drawerOpen);

  return (
    <div className="flex min-h-svh bg-ink text-cream">
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
        <header className="flex items-center border-b border-line bg-ink px-4 py-3 pt-safe-t md:hidden">
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav"
            onClick={() => setDrawerOpen(true)}
            className={
              "mr-3 -ml-2 inline-flex h-11 w-11 items-center justify-center rounded text-cream-muted " +
              "hover:bg-ink-raised hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
            }
          >
            <HamburgerIcon />
          </button>
          <Wordmark size="sm" />
          <button
            type="button"
            aria-label="Search messages"
            onClick={dispatchOpenSearch}
            className={
              "ml-auto -mr-2 inline-flex h-11 w-11 items-center justify-center rounded text-cream-muted " +
              "hover:bg-ink-raised hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
            }
          >
            <SearchIcon />
          </button>
        </header>

        {/* Mobile drawer */}
        <div
          ref={drawerRef}
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
          aria-hidden={!drawerOpen}
          className={cn(
            "fixed inset-0 z-40 md:hidden",
            drawerOpen ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          <button
            type="button"
            aria-label="Dismiss navigation menu"
            tabIndex={drawerOpen ? 0 : -1}
            onClick={closeDrawer}
            className={cn(
              "fixed inset-0 cursor-default bg-black/60 transition-opacity duration-base",
              "focus:outline-none focus-visible:shadow-glow-gold",
              drawerOpen ? "opacity-100" : "opacity-0",
            )}
          />
          <nav
            aria-label="Main navigation"
            className={cn(
              "absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-ink-raised shadow-pop",
              "pt-safe-t pb-safe-b pl-safe-l",
              "transition-transform duration-base will-change-transform",
              drawerOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <div className="flex items-center justify-between px-5 py-4">
              <Wordmark size="sm" />
              <button
                type="button"
                aria-label="Close navigation menu"
                tabIndex={drawerOpen ? 0 : -1}
                onClick={closeDrawer}
                className={
                  "-mr-2 inline-flex h-11 w-11 items-center justify-center rounded text-cream-muted " +
                  "hover:bg-ink hover:text-cream " +
                  "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
                }
              >
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-momentum">
              <NavLinks onNavigate={closeDrawer} />
            </div>
            <div className="border-t border-line px-2 py-3">
              <SignOutButton onNavigate={closeDrawer} />
            </div>
          </nav>
        </div>

        <DeletionBanner />
        <main
          className={cn(
            "flex-1 bg-ink",
            // Full-height surfaces (chat) manage their own scrolling
            // inside; without overflow-hidden the outer would scroll
            // and push the composer below the visible viewport on iOS.
            fullHeight
              ? "flex min-h-0 flex-col overflow-hidden"
              : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
