"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { DeletionBanner } from "@/components/account/DeletionBanner";
import { MobileTabBar } from "@/components/nav/MobileTabBar";
import { Heading, Link, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroups } from "@/lib/hooks/useGroups";
import { useMyOrgs } from "@/lib/hooks/useMyOrgs";
import { type RoleClaims, useRoleClaims } from "@/lib/hooks/useRoleClaims";

// The search button (mobile top bar + desktop sidebar header) dispatches
// this event; SearchBar (mounted by AuthedLayout) listens for it. Going
// through window means AppShell doesn't need to import SearchBar — that
// kept several test bundles lean and avoided dragging useSearch into
// every AppShell mount.
function dispatchOpenSearch() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("jacob:open-search"));
  }
}

// Nav structure for the DESKTOP SIDEBAR.
//
// The v2 redesign removes the mobile hamburger drawer entirely: all mobile
// navigation now lives in the bottom tab bar (Groups / Boards / Events /
// Grow / Manage) plus the slim top bar (search + avatar → settings).
//
// Desktop, however, has no bottom tab bar, so the sidebar stays — a
// deliberate, documented deviation from the doc's "no side rail" stance to
// avoid stranding desktop users in Phase 1. The sidebar mirrors the new
// IA: the four member destinations (no "Home"), the Grow-section long tail
// (Devotionals / Reading plans / Discover / Search) so nothing is
// orphaned, the "You" long tail (settings / ministries / legal / info),
// and a role-gated Manage entry.
type NavLink = { href: string; label: string };
type NavGroup = { label: string; links: NavLink[] };

const EXPLORE: NavGroup = {
  label: "Explore",
  links: [
    { href: "/groups", label: "Groups" },
    { href: "/boards", label: "Boards" },
    { href: "/events", label: "Events" },
    { href: "/grow", label: "Grow" },
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

function buildManageGroup(
  roles: RoleClaims | null,
  leadsAnyGroup: boolean,
): NavGroup | null {
  // While `roles` is `null` (first paint after token refresh) we render
  // nothing so admins/leaders don't see a flash-then-disappear "Manage"
  // entry if the claim later resolves to false.
  if (!roles) return null;
  const privileged =
    roles.isAdmin ||
    roles.isModerator ||
    roles.isMinistryOwner ||
    leadsAnyGroup;
  if (!privileged) return null;
  return { label: "Manage", links: [{ href: "/manage", label: "Manage" }] };
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

function NavSection({ group }: { group: NavGroup }) {
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

function NavLinks() {
  const { user } = useAuth();
  const roles = useRoleClaims();
  const { orgs } = useMyOrgs();
  const { groups } = useGroups(user?.uid);
  const leadsAnyGroup = groups.some((g) => g.role === "leader");
  const youGroup = buildYouGroup(orgs.length > 0);
  const manageGroup = buildManageGroup(roles, leadsAnyGroup);
  const sections: NavGroup[] = [EXPLORE, GROW, youGroup];
  if (manageGroup) sections.push(manageGroup);
  return (
    <div>
      {sections.map((group) => (
        <NavSection key={group.label} group={group} />
      ))}
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await signOut();
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
  return (
    <div className="flex min-h-svh bg-ink text-cream">
      {/* Desktop sidebar — pinned to the viewport (sticky top-0, full
       * viewport height) so the rail never scrolls away even if the
       * document itself scrolls. Mirrors the always-visible mobile tab
       * bar on the desktop form factor. Desktop has no bottom tab bar, so
       * the sidebar is the only nav on this form factor (the mobile
       * hamburger drawer was removed in the v2 redesign). */}
      <aside className="hidden w-56 flex-none flex-col border-r border-line bg-ink md:flex md:sticky md:top-0 md:h-svh md:self-start">
        <div className="flex items-center justify-between px-5 py-6">
          <Wordmark size="sm" />
          {/* Parity with the mobile top-bar search icon. The Grow > Search
           * nav link covers discovery; this icon covers speed. */}
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

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Slim mobile top bar — wordmark + scoped search + avatar. The
         * hamburger drawer is gone (v2 redesign §7.1); all mobile nav is
         * the bottom tab bar. The avatar is the one-tap path to /settings,
         * which aggregates the account long tail (profile, notifications,
         * blocked, data export, appeals, ministries, about, faq, sign
         * out). */}
        <header className="flex items-center border-b border-line bg-ink px-4 py-3 pt-safe-t md:hidden">
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
