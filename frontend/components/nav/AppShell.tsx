"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { DeletionBanner } from "@/components/account/DeletionBanner";
import { MobileTabBar } from "@/components/nav/MobileTabBar";
import { Heading, Link, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { useMyOrgs } from "@/lib/hooks/useMyOrgs";
import { type RoleClaims, useRoleClaims } from "@/lib/hooks/useRoleClaims";

// The search button (mobile header + desktop sidebar header) dispatches
// this event; SearchBar (mounted by AuthedLayout) listens for it. Going
// through window means AppShell doesn't need to import SearchBar — that
// kept several test bundles lean and avoided dragging useSearch into
// every AppShell mount.
function dispatchOpenSearch() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("jacob:open-search"));
  }
}

// Nav structure — the drawer/sidebar groups the same labels into sections
// (Explore / Grow / You / Admin) so a flat 12-item list becomes a
// navigable hierarchy. The mobile bottom tab bar (see MobileTabBar)
// surfaces four destinations — Home, Groups, Boards (from Explore) and
// Grow. The ministry feed is deliberately drawer-only, not a tab:
// groups are the daily reality, the org tier is mostly future structure.
// The drawer continues to list every entry so desktop (which has no tab
// bar) and any user browsing the long tail still has one authoritative
// list.
type NavLink = { href: string; label: string };
type NavGroup = { label: string; links: NavLink[] };

const EXPLORE: NavGroup = {
  label: "Explore",
  links: [
    { href: "/home", label: "Home" },
    { href: "/groups", label: "Groups" },
    { href: "/boards", label: "Boards" },
    // Ministry feed — still reachable here, but no longer a bottom
    // tab. Listed last in Explore to mirror its demoted prominence.
    { href: "/feed", label: "Feed" },
  ],
};

const GROW: NavGroup = {
  label: "Grow",
  links: [
    { href: "/devotionals", label: "Devotionals" },
    { href: "/reading-plans", label: "Reading plans" },
    { href: "/discover", label: "Discover groups" },
    { href: "/search", label: "Search" },
  ],
};

const YOU_BASE_LINKS: NavLink[] = [
  { href: "/settings", label: "Settings" },
  { href: "/appeals/new", label: "Submit an appeal" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
];

function buildYouGroup(hasOrgs: boolean): NavGroup {
  // Ministries sits between Settings and the legal/info long-tail —
  // visible only when the user actually belongs to ≥1 org, matching the
  // previous "irrelevant for most users" treatment.
  const links: NavLink[] = [YOU_BASE_LINKS[0]];
  if (hasOrgs) {
    links.push({ href: "/orgs", label: "Ministries" });
  }
  links.push(...YOU_BASE_LINKS.slice(1));
  return { label: "You", links };
}

function buildAdminGroup(roles: RoleClaims | null): NavGroup | null {
  // While `roles` is `null` (first paint after token refresh) we render
  // nothing so admins don't see a flash-then-disappear "Admin" entry if
  // the claim later resolves to false.
  if (!roles) return null;
  if (roles.isAdmin) {
    return {
      label: "Admin",
      links: [{ href: "/admin/queue", label: "Admin console" }],
    };
  }
  if (roles.isModerator) {
    return {
      label: "Moderation",
      links: [{ href: "/admin/wellbeing", label: "Wellbeing" }],
    };
  }
  return null;
}

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

function NavSection({
  group,
  onNavigate,
}: {
  group: NavGroup;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="px-2 pb-2 pt-3 first:pt-1">
      <p className="px-3 pb-1 text-eyebrow uppercase tracking-wider text-cream-muted/70">
        {group.label}
      </p>
      <ul className="space-y-1">
        {group.links.map(({ href, label }) => {
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
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const roles = useRoleClaims();
  const { orgs } = useMyOrgs();
  const youGroup = buildYouGroup(orgs.length > 0);
  const adminGroup = buildAdminGroup(roles);
  const groups: NavGroup[] = [EXPLORE, GROW, youGroup];
  if (adminGroup) groups.push(adminGroup);
  return (
    <div>
      {groups.map((group) => (
        <NavSection key={group.label} group={group} onNavigate={onNavigate} />
      ))}
    </div>
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

function PersonIcon() {
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
      <circle cx="12" cy="8" r="4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8"
      />
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
      {/* Desktop sidebar — pinned to the viewport (sticky top-0, full
       * viewport height) so the rail never scrolls away even if the
       * document itself scrolls. Mirrors the always-visible mobile tab
       * bar on the desktop form factor. */}
      <aside className="hidden w-56 flex-none flex-col border-r border-line bg-ink md:flex md:sticky md:top-0 md:h-svh md:self-start">
        <div className="flex items-center justify-between px-5 py-6">
          <Wordmark size="sm" />
          {/* Parity with the mobile header search icon — desktop didn't
           * have a search shortcut before, so /search was effectively
           * undiscoverable without typing the URL. The Grow > Search nav
           * link covers discovery; this icon covers speed. */}
          <button
            type="button"
            aria-label="Search messages"
            onClick={dispatchOpenSearch}
            className={
              "-mr-2 inline-flex h-9 w-9 items-center justify-center rounded text-cream-muted " +
              "hover:bg-ink-raised hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
            }
          >
            <SearchIcon />
          </button>
        </div>
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto">
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
              "ml-auto inline-flex h-11 w-11 items-center justify-center rounded text-cream-muted " +
              "hover:bg-ink-raised hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
            }
          >
            <SearchIcon />
          </button>
          {/* Profile shortcut — the bottom tab bar (Home / Groups /
           * Boards / Grow) has no account slot, so this is the one-tap
           * path to /settings (account, appeals, orgs, admin, info,
           * sign out). Drawer YOU > Settings also works (two taps). */}
          <Link
            href="/settings"
            aria-label="Account"
            variant="muted"
            className={
              "-mr-2 inline-flex h-11 w-11 items-center justify-center rounded text-cream-muted no-underline " +
              "hover:bg-ink-raised hover:text-cream " +
              "focus:outline-none focus-visible:shadow-glow-gold transition-colors duration-fast"
            }
          >
            <PersonIcon />
          </Link>
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
              : // The mobile tab bar is fixed over the bottom of the
                // viewport, so reserve its height (+ safe-area inset) as
                // scrollable bottom padding — the last row of content
                // clears the bar instead of hiding behind it. Desktop has
                // no bottom bar, so the reservation drops at md+.
                "overflow-y-auto pb-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom,0px))] md:pb-0",
          )}
        >
          {children}
        </main>
        {/* Mobile bottom tabs render only on non-fullHeight routes (chat
         * keeps the focus surface clear). Hidden at md+ where the
         * desktop sidebar already covers nav. */}
        {!fullHeight && <MobileTabBar />}
      </div>
    </div>
  );
}
