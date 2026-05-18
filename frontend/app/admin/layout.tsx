"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const ADMIN_NAV_LINKS = [
  { href: "/admin/queue", label: "Moderation Queue" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/groups", label: "Groups" },
  { href: "/admin/flags", label: "Feature Flags" },
  { href: "/admin/incidents", label: "Incidents" },
  { href: "/admin/ncmec", label: "NCMEC" },
  { href: "/admin/appeals", label: "Appeals" },
  { href: "/admin/transparency", label: "Transparency" },
  { href: "/admin/wellbeing", label: "Wellbeing" },
];

const MODERATOR_NAV_LINKS = [{ href: "/admin/wellbeing", label: "Wellbeing" }];

type AuthState = "loading" | "allowed" | "denied";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [navLinks, setNavLinks] = useState(ADMIN_NAV_LINKS);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/home");
      return;
    }
    user.getIdTokenResult().then((result) => {
      const isAdmin = result.claims.admin === true;
      const isModerator = result.claims.moderator === true;
      if (isAdmin) {
        setNavLinks(ADMIN_NAV_LINKS);
        setAuthState("allowed");
      } else if (isModerator) {
        setNavLinks(MODERATOR_NAV_LINKS);
        setAuthState("allowed");
      } else {
        router.replace("/home");
      }
    });
  }, [user, loading, router]);

  if (authState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
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
