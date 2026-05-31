"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import { cn } from "@/components/ui";

const tabs = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/groups", label: "Groups", icon: GroupsIcon },
  { href: "/boards", label: "Boards", icon: BoardsIcon },
  { href: "/grow", label: "Grow", icon: GrowIcon },
] as const;

/**
 * Mobile-only bottom tab bar — the primary nav on phones.
 *
 * Four tabs covering the most-used destinations: Home, Groups, Boards,
 * Grow. "Groups" is the user's group list, and group chat lives one tap
 * inside each group — so the list and chat are one destination, not two
 * tabs. The ministry feed is intentionally NOT a tab: groups are the
 * daily reality, the org tier is mostly future structure, so the feed is
 * demoted to the drawer's Explore section (and the home surface's
 * ministry section) while groups take a primary slot. Profile /
 * settings / sign-out live on `/settings` and are reachable in one tap
 * via the avatar button in the mobile header (and the drawer's "You"
 * section).
 *
 * The bar is `position: fixed` at the bottom of the viewport so it stays
 * put no matter how tall (or how scrolled) the page is — the nav is never
 * something you have to scroll down to reach. AppShell adds matching
 * bottom padding to `<main>` so page content clears the bar instead of
 * hiding behind it. `z-30` keeps it above page content but below the nav
 * drawer (z-40) and dialogs (z-50). `pb-safe-b` lifts the touch targets
 * above the iOS home indicator.
 *
 * Hidden on `fullHeight` routes (chat) — those surfaces want every
 * pixel for the message log and composer.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary navigation"
      className={cn(
        // Pinned to the bottom edge of the viewport, full width, always
        // visible. fixed escapes AppShell's overflow-hidden column (no
        // ancestor sets a transform, so the viewport is the containing
        // block) — it is never clipped or scrolled away.
        "fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-ink pb-safe-b md:hidden",
      )}
    >
      {tabs.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // min-height is the shared --mobile-tab-bar-height token so
              // FloatingActionBar can anchor itself just above the bar.
              "group flex min-h-[var(--mobile-tab-bar-height)] flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-2",
              "text-eyebrow uppercase no-underline transition-colors duration-fast",
              "focus:outline-none focus-visible:bg-ink-raised",
              active
                ? "text-gold"
                : "text-cream-muted hover:text-cream",
            )}
          >
            <Icon active={active} />
            <span className="text-[10px] tracking-wider">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

type IconProps = { active: boolean };

function HomeIcon(_: IconProps) {
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function GroupsIcon(_: IconProps) {
  // Two figures — the "Groups" destination is the user's group list
  // (group chat lives one tap inside each group). Replaces the former
  // single speech-bubble "Chats" glyph now that the tab's identity is
  // groups, not a generic chat surface.
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
      <circle cx="9" cy="8.5" r="3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 19c0-3.04 2.46-5.5 5.5-5.5s5.5 2.46 5.5 5.5"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.5 6.1a3 3 0 0 1 0 5.8M16.8 14.2c2.45.62 4.2 2.6 4.2 4.8"
      />
    </svg>
  );
}

function BoardsIcon(_: IconProps) {
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
      <rect x="4" y="4" width="7" height="7" rx="1" strokeLinejoin="round" />
      <rect x="13" y="4" width="7" height="7" rx="1" strokeLinejoin="round" />
      <rect x="4" y="13" width="7" height="7" rx="1" strokeLinejoin="round" />
      <rect x="13" y="13" width="7" height="7" rx="1" strokeLinejoin="round" />
    </svg>
  );
}

function GrowIcon(_: IconProps) {
  // Sprout / two leaves rising from a stem — picks up the "Grow"
  // metaphor literally and reads at small sizes (5×5 / 20px square)
  // without any extra detail.
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
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21V11M12 11C12 7 9 5 5 5c0 4 2 7 7 7zM12 11c0-3 2-5 6-5 0 3-2 6-6 6z"
      />
    </svg>
  );
}
