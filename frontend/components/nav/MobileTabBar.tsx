"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import { cn } from "@/components/ui";

const tabs = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/groups", label: "Chats", icon: ChatIcon },
  { href: "/boards", label: "Boards", icon: BoardsIcon },
  { href: "/feed", label: "Feed", icon: FeedIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

/**
 * Mobile-only bottom tab bar — the primary nav on phones.
 *
 * Five tabs covering the most-used destinations. About / FAQ / Sign out
 * remain in the hamburger drawer for the long tail. The bar is a flex
 * sibling of `<main>` inside AppShell's inner column, so it occupies
 * its natural height and content scrolls above it.
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
        // Flex sibling of <main>; not fixed-positioned. AppShell's inner
        // column is a flex column, so this sits at the bottom naturally
        // and content above scrolls within main without ever sitting
        // underneath it.
        "flex shrink-0 border-t border-line bg-ink pb-safe-b md:hidden",
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
              "group flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-2",
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

function ChatIcon(_: IconProps) {
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11H8l-4 4z" />
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

function FeedIcon(_: IconProps) {
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10v4l11 5V5zM18 8a4 4 0 0 1 0 8" />
    </svg>
  );
}

function SettingsIcon(_: IconProps) {
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
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  );
}
