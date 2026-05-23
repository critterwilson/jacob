"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuth } from "@/lib/auth-context";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

const ADMIN_NAV_LINKS = [
  { href: "/admin/queue", label: "Moderation Queue" },
  // ADR 0015 — owner-facing queues. The legacy /admin/applications stays
  // reachable for the residual ADR 0012 queue but new signups never
  // land in it.
  { href: "/admin/leader-applications", label: "Leader applications" },
  { href: "/admin/minor-reviews", label: "Minor reviews" },
  { href: "/admin/applications", label: "Applications (legacy)" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/groups", label: "Groups" },
  { href: "/admin/boards", label: "Boards" },
  { href: "/admin/flags", label: "Feature Flags" },
  { href: "/admin/incidents", label: "Incidents" },
  { href: "/admin/ncmec", label: "NCMEC" },
  { href: "/admin/appeals", label: "Appeals" },
  { href: "/admin/transparency", label: "Transparency" },
  { href: "/admin/wellbeing", label: "Wellbeing" },
];

const MODERATOR_NAV_LINKS = [{ href: "/admin/wellbeing", label: "Wellbeing" }];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  // useRoleClaims force-refreshes the ID token, so a freshly-granted
  // admin/moderator role lets the user in without waiting for a re-login.
  const claims = useRoleClaims();
  const router = useRouter();
  const pathname = usePathname();

  const allowed = claims !== null && (claims.isAdmin || claims.isModerator);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/home");
      return;
    }
    // Claims resolved and the user holds neither role — bounce them out.
    if (claims !== null && !claims.isAdmin && !claims.isModerator) {
      router.replace("/home");
    }
  }, [user, loading, claims, router]);

  if (loading || claims === null || !allowed) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </div>
    );
  }

  const navLinks = claims.isAdmin ? ADMIN_NAV_LINKS : MODERATOR_NAV_LINKS;

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      {/* Mobile: horizontal scrolling chip nav. Sticky so it stays
       * visible while the admin scrolls long lists. */}
      <nav
        aria-label="Admin sections"
        className="sticky top-0 z-10 border-b border-line bg-ink-raised px-4 py-2 md:hidden"
      >
        <ul className="flex gap-1 overflow-x-auto">
          {navLinks.map(({ href, label }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  className={`inline-flex h-9 items-center rounded-full px-3 text-sm whitespace-nowrap ${
                    active
                      ? "bg-ink-overlay font-medium text-gold-soft"
                      : "text-cream hover:bg-ink-overlay"
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop: fixed-width sidebar. */}
      <nav className="hidden w-48 shrink-0 border-r border-line bg-ink-raised p-4 md:block">
        <p className="mb-4 text-eyebrow uppercase tracking-wider text-cream-muted">
          Admin
        </p>
        <ul className="space-y-1">
          {navLinks.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={`block rounded px-3 py-2 text-sm ${
                  pathname.startsWith(href)
                    ? "bg-ink-overlay font-medium text-gold-soft"
                    : "text-cream hover:bg-ink-overlay"
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 border-t border-line pt-4">
          <Link href="/home" className="text-xs text-cream-muted hover:text-cream">
            ← Back to app
          </Link>
        </div>
      </nav>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
