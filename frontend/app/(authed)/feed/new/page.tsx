"use client";

import { useRouter } from "next/navigation";

import { NewMinistryPostForm } from "@/components/ministry/NewMinistryPostForm";
import { Banner, Eyebrow, Heading, Link } from "@/components/ui";
import { useMinistryOwner } from "@/lib/hooks/useMinistryOwner";

export default function NewMinistryPostPage() {
  const router = useRouter();
  const isOwner = useMinistryOwner();

  if (isOwner === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }

  if (!isOwner) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <Link href="/feed" variant="muted" className="text-caption">
          ← Ministry feed
        </Link>
        <Banner tone="error">Only ministry owners can create posts.</Banner>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href="/feed" variant="muted" className="text-caption">
        ← Ministry feed
      </Link>

      <header className="space-y-1">
        <Eyebrow>Broadcast</Eyebrow>
        <Heading level={1} size="md">
          New post
        </Heading>
      </header>

      <NewMinistryPostForm onPosted={() => router.push("/feed")} />
    </main>
  );
}
