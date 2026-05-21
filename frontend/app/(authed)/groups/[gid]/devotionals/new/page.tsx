"use client";

import { useParams, useRouter } from "next/navigation";

import { OpenBook } from "@/components/motifs/OpenBook";
import { DevotionalForm } from "@/components/devotionals/DevotionalForm";
import type { DevotionalFormValues } from "@/components/devotionals/DevotionalForm";
import { Banner, Eyebrow, Heading, Link } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useDevotionalMutations } from "@/lib/hooks/useDevotionals";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";

export default function NewGroupDevotionalPage() {
  const router = useRouter();
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const { user } = useAuth();
  const { isLeader, loading } = useGroupMembership(user?.uid, gid);
  const { createDevotional } = useDevotionalMutations();

  if (loading || !user) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink text-body-sm text-cream-muted">
        Loading…
      </div>
    );
  }

  if (!isLeader) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <Link
          href={`/groups/${gid}/devotionals`}
          variant="muted"
          className="text-caption"
        >
          ← Devotionals
        </Link>
        <Banner tone="error">
          Only group leaders can write devotionals for this group.
        </Banner>
      </main>
    );
  }

  const handleSubmit = async (
    values: DevotionalFormValues,
  ): Promise<string | null> => {
    const res = await createDevotional({
      slug: values.slug,
      title: values.title,
      scriptureRef: values.scriptureRef || undefined,
      body: values.body,
      audioUrl: values.audioUrl || null,
      sourceAttribution: values.sourceAttribution || undefined,
      publishedAt: values.publishedAt || null,
      audience: values.audience,
      // Auto-scope to this group so the form itself doesn't need to
      // expose `groupId`. The backend enforces leader-of-this-group.
      groupId: gid,
    });
    if (!res)
      return "Failed to create devotional — the slug may already be taken.";
    router.push(`/devotionals/${res.slug}`);
    return null;
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link
        href={`/groups/${gid}/devotionals`}
        variant="muted"
        className="text-caption"
      >
        ← Devotionals
      </Link>

      <header className="flex items-center gap-5">
        <OpenBook className="h-12 w-auto shrink-0 text-gold-soft opacity-90" />
        <div className="space-y-1">
          <Eyebrow>Group</Eyebrow>
          <Heading level={1} size="md">
            Write a devotional
          </Heading>
          <p className="text-body-sm text-cream-muted">
            Visible only to members of this group.
          </p>
        </div>
      </header>

      <DevotionalForm
        mode="create"
        submitLabel="Publish to group"
        onSubmit={handleSubmit}
      />
    </main>
  );
}
