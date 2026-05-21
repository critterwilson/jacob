"use client";

import { useParams, useRouter } from "next/navigation";

import { OpenBook } from "@/components/motifs/OpenBook";
import { SermonForm } from "@/components/groups/SermonForm";
import type { SermonFormValues } from "@/components/groups/SermonForm";
import { Banner, Eyebrow, Heading, Link } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useGroupMembership } from "@/lib/hooks/useGroupMembership";
import { useGroupSermons } from "@/lib/hooks/useGroupSermons";

export default function NewSermonPage() {
  const params = useParams();
  const gid = String(
    Array.isArray(params?.gid) ? params.gid[0] : (params?.gid ?? ""),
  );
  const router = useRouter();
  const { user } = useAuth();
  const { isLeader, loading: membershipLoading } = useGroupMembership(
    user?.uid,
    gid,
  );
  const { addSermon } = useGroupSermons(gid);

  if (membershipLoading) {
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
          href={`/groups/${gid}/sermons`}
          variant="muted"
          className="text-caption"
        >
          ← Sermon archive
        </Link>
        <Banner tone="error">Only group leaders can add sermons.</Banner>
      </main>
    );
  }

  const handleSubmit = async (
    values: SermonFormValues,
  ): Promise<string | null> => {
    const res = await addSermon({
      sourceUrl: values.sourceUrl,
      title: values.title || undefined,
      preacher: values.preacher || undefined,
      scripture: values.scripture || undefined,
      sermonDate: values.sermonDate || undefined,
    });
    if (!res) return "Failed to add sermon — check the URL is valid.";
    router.push(`/groups/${gid}/sermons/${res.sermonId}`);
    return null;
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link
        href={`/groups/${gid}/sermons`}
        variant="muted"
        className="text-caption"
      >
        ← Sermon archive
      </Link>

      <header className="flex items-center gap-5">
        <OpenBook className="h-12 w-auto shrink-0 text-gold-soft opacity-90" />
        <div className="space-y-1">
          <Eyebrow>Group library</Eyebrow>
          <Heading level={1} size="md">
            Add a sermon
          </Heading>
        </div>
      </header>

      <SermonForm mode="create" submitLabel="Add sermon" onSubmit={handleSubmit} />
    </main>
  );
}
