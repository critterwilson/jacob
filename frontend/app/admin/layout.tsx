"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const NAV_LINKS = [
  { href: "/admin/queue", label: "Moderation Queue" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/groups", label: "Groups" },
  { href: "/admin/flags", label: "Feature Flags" },
  { href: "/admin/incidents", label: "Incidents" },
  { href: "/admin/ncmec", label: "NCMEC" },
  { href: "/admin/appeals", label: "Appeals" },
  { href: "/admin/transparency", label: "Transparency" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/home");
      return;
    }
    user.getIdTokenResult().then((result) => {
      if (result.claims.admin === true) {
        setIsAdmin(true);
      } else {
        router.replace("/home");
      }
    });
  }, [user, loading, router]);

  if (loading || isAdmin === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-48 shrink-0 border-r border-gray-200 bg-gray-50 p-4">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Admin
        </p>
        <ul className="space-y-1">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={`block rounded px-3 py-2 text-sm ${
                  pathname.startsWith(href)
                    ? "bg-blue-100 font-medium text-blue-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 border-t border-gray-200 pt-4">
          <Link href="/home" className="text-xs text-gray-500 hover:text-gray-700">
            ← Back to app
          </Link>
        </div>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
