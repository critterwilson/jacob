"use client";

import { VideoEmbed } from "@/components/media/VideoEmbed";
import { Eyebrow, Heading, Skeleton } from "@/components/ui";
import type { WeeklySermon as WeeklySermonData } from "@/lib/hooks/useWeeklySermon";

type Props = {
  sermon: WeeklySermonData | null;
  loading: boolean;
};

export function WeeklySermon({ sermon, loading }: Props) {
  if (loading && !sermon) {
    return (
      <div className="space-y-3">
        <Skeleton className="aspect-video w-full rounded-lg" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    );
  }

  if (!sermon) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-ink-raised px-4 py-10 text-center">
        <Eyebrow>This week&apos;s sermon</Eyebrow>
        <p className="mt-2 text-body-sm text-cream-muted">
          No sermon has been posted yet. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="weekly-sermon-heading" className="space-y-3">
      <Eyebrow>This week&apos;s sermon</Eyebrow>
      <VideoEmbed url={sermon.videoUrl} title={sermon.title} />
      <Heading level={2} size="md" id="weekly-sermon-heading">
        {sermon.title}
      </Heading>
      {sermon.description && (
        <p className="whitespace-pre-line text-body text-cream-muted">
          {sermon.description}
        </p>
      )}
    </section>
  );
}
