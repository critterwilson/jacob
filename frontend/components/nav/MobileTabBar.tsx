"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/components/ui";
import { useGroups } from "@/lib/hooks/useGroups";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";
import { useAuth } from "@/lib/auth-context";

type Tab = {
  href: string;
  label: string;
  icon: (props: IconProps) => ReactNode;
};

// The member tab set — role-invariant. Per the v2 redesign IA (§4.2)
// these four never move or reorder by role: Groups, Boards, Events, Grow.
// "Home" is gone (the dashboard was deleted as a destination — members
// land in their groups). A leader/owner/admin gets a fifth "Manage" tab
// appended; the four member tabs keep their position so muscle memory
// holds (principle 1.5: role widens the same app, it isn't a new app).
const MEMBER_TABS: readonly Tab[] = [
  { href: "/groups", label: "Groups", icon: GroupsIcon },
  { href: "/boards", label: "Boards", icon: BoardsIcon },
  { href: "/events", label: "Events", icon: EventsIcon },
  { href: "/grow", label: "Grow", icon: GrowIcon },
] as const;

const MANAGE_TAB: Tab = { href: "/manage", label: "Manage", icon: ManageIcon };

/**
 * Mobile-only bottom tab bar — the primary nav on phones (the hamburger
 * drawer was removed in the v2 redesign; all mobile nav lives here + the
 * slim top bar).
 *
 * Four role-invariant member tabs — Groups, Boards, Events, Grow — plus a
 * fifth role-gated "Manage" tab for leaders, ministry owners, moderators
 * and admins. "Groups" is the user's group list, and group chat lives one
 * tap inside each group, so the list and chat are one destination, not two
 * tabs. Profile / settings / sign-out live on `/settings` and are reachable
 * in one tap via the avatar button in the mobile top bar.
 *
 * The bar is `position: fixed` at the bottom of the viewport so it stays
 * put no matter how tall (or how scrolled) the page is — the nav is never
 * something you have to scroll down to reach. AppShell adds matching
 * bottom padding to `<main>` so page content clears the bar instead of
 * hiding behind it. `z-30` keeps it above page content but below dialogs
 * (z-50). `pb-safe-b` lifts the touch targets above the iOS home indicator.
 *
 * Hidden on `fullHeight` routes (chat) — those surfaces want every
 * pixel for the message log and composer.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const tabs = useTabs();
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

/**
 * Builds the visible tab list. Members get the four base tabs; the fifth
 * "Manage" tab appears for anyone with a management duty — i.e. EITHER:
 *
 *  - a platform claim (admin / moderator / ministry owner), via the ID
 *    token, OR
 *  - a per-group "leader" role on any group the user belongs to — the
 *    cheap signal already loaded for the Groups list (`useGroups` returns
 *    each group's `role`), so detecting "leader of any group" costs no
 *    extra request.
 *
 * `useRoleClaims` returns `null` until the token resolves; we treat that
 * as "not privileged yet" so the bar never flashes a Manage tab that then
 * disappears for a plain member.
 */
function useTabs(): readonly Tab[] {
  const { user } = useAuth();
  const roles = useRoleClaims();
  const { groups } = useGroups(user?.uid);

  const isPrivilegedClaim = Boolean(
    roles && (roles.isAdmin || roles.isModerator || roles.isMinistryOwner),
  );
  const leadsAnyGroup = groups.some((g) => g.role === "leader");

  if (isPrivilegedClaim || leadsAnyGroup) {
    return [...MEMBER_TABS, MANAGE_TAB];
  }
  return MEMBER_TABS;
}

type IconProps = { active: boolean };

function GroupsIcon(_: IconProps) {
  // Two figures — the "Groups" destination is the user's group list
  // (group chat lives one tap inside each group).
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

function EventsIcon(_: IconProps) {
  // Calendar — the "Events" destination (what's coming up + RSVP).
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
      <rect x="3.5" y="5" width="17" height="15" rx="2" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
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

function ManageIcon(_: IconProps) {
  // Shield-with-check — the role-gated "Manage" destination (approvals,
  // moderation, org admin). Reads as "duty / oversight" at small sizes.
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
        d="M12 3l7 2.5v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V5.5z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 11.5 2 2 4-4" />
    </svg>
  );
}
