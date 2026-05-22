"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuth } from "@/lib/auth-context";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

const ADMIN_NAV_LINKS = [
  { href: "/admin/queue", label: "Moderation Queue" },
  { href: "/admin/applications", label: "Applications" },
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
    <div className="flex min-h-svh">
      <nav className="w-48 shrink-0 border-r border-line bg-ink-raised p-4">
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
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
