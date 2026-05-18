"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { CreateGroupForm } from "@/components/groups/CreateGroupForm";
import { useAuth } from "@/lib/auth-context";

export default function NewGroupPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-cream-muted">Loading…</span>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Create a group</h1>
        <Link href="/groups" className="text-sm text-gold hover:underline">
          Back to groups
        </Link>
      </div>
      <CreateGroupForm />
    </main>
  );
}
