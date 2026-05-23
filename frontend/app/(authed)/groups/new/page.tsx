"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { CreateGroupForm } from "@/components/groups/CreateGroupForm";
import { useAuth } from "@/lib/auth-context";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";

export default function NewGroupPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const claims = useRoleClaims();
  // ADR 0014 — direct group creation is owner/admin-only. Non-owners
  // who land here (typically from an outdated bookmark) are bounced to
  // the leader-application form. Owner/admin users see the form
  // unchanged.
  const canCreateDirectly =
    !!claims && (claims.isAdmin || claims.isMinistryOwner);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in");
      return;
    }
    if (!loading && claims !== null && !canCreateDirectly) {
      router.replace("/leader-application");
    }
  }, [user, loading, claims, canCreateDirectly, router]);

  if (loading || claims === null) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user || !canCreateDirectly) return null;

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Create a group</h1>
        <Link href="/groups" className="text-sm text-gold hover:underline">
          Back to groups
        </Link>
      </div>
      <p className="mb-6 text-body-sm text-cream-muted">
        Groups are spaces for Bible study, prayer, and connection. You&apos;ll
        be the founder and can invite members once it&apos;s set up.
      </p>
      <CreateGroupForm />
    </main>
  );
}
