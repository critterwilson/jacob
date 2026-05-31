"use client";

import { useRouter } from "next/navigation";

import { OpenBook } from "@/components/motifs/OpenBook";
import { DevotionalForm } from "@/components/devotionals/DevotionalForm";
import type { DevotionalFormValues } from "@/components/devotionals/DevotionalForm";
import { Banner, Eyebrow, Heading, Link } from "@/components/ui";
import { useRoleClaims } from "@/lib/hooks/useRoleClaims";
import { useDevotionalMutations } from "@/lib/hooks/useDevotionals";

export default function NewDevotionalPage() {
  const router = useRouter();
  const claims = useRoleClaims();
  const { createDevotional } = useDevotionalMutations();

  // null = still loading claims; render nothing to avoid flash of error.
  if (claims === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }

  if (!claims.isMinistryOwner) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <Link href="/devotionals" variant="muted" className="text-caption">
          ← Devotionals
        </Link>
        <Banner tone="error">
          Only ministry owners can write devotionals.
        </Banner>
      </main>
    );
  }

  const handleSubmit = async (
    values: DevotionalFormValues,
  ): Promise<string | null> => {
    const res = await createDevotional({
      title: values.title,
      scriptureRef: values.scriptureRef || undefined,
      body: values.body,
      audioUrl: values.audioUrl || null,
      sourceAttribution: values.sourceAttribution || undefined,
      publishedAt: values.publishedAt || null,
      audience: values.audience,
    });
    if (!res) return "Failed to create devotional.";
    // Backend returns `path` like "org/<slug>" — link straight to it.
    router.push(`/devotionals/${res.path}`);
    return null;
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href="/devotionals" variant="muted" className="text-caption">
        ← Devotionals
      </Link>

      <header className="flex items-center gap-5">
        <OpenBook className="h-12 w-auto shrink-0 text-gold-soft opacity-90" />
        <div className="space-y-1">
          <Eyebrow>Ministry</Eyebrow>
          <Heading level={1} size="md">
            Write a devotional
          </Heading>
        </div>
      </header>

      <DevotionalForm
        mode="create"
        submitLabel="Publish devotional"
        onSubmit={handleSubmit}
      />
    </main>
  );
}
