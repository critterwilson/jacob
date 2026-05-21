"use client";

import Link from "next/link";

import { Card, Eyebrow, Heading, Skeleton } from "@/components/ui";
import type { Devotional } from "@/lib/hooks/useDevotionals";

type Props = {
  devotional: Devotional | null;
  loading: boolean;
};

const PREVIEW_CHARS = 180;

function stripMarkdown(body: string): string {
  return body.replace(/[*_#`>]/g, "").replace(/\n+/g, " ").trim();
}

export function TodayDevotional({ devotional, loading }: Props) {
  if (loading) {
    return (
      <Card surface="raised" className="space-y-3">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </Card>
    );
  }

  if (!devotional) {
    return (
      <Card surface="raised" className="space-y-2">
        <Eyebrow>Devotional</Eyebrow>
        <p className="text-body-sm text-cream-muted">
          No devotionals published yet. Check back soon.
        </p>
      </Card>
    );
  }

  const preview = stripMarkdown(devotional.body).slice(0, PREVIEW_CHARS);

  return (
    <Link
      href={`/devotionals/${devotional.slug}`}
      className="block rounded-lg no-underline focus:outline-none focus-visible:shadow-glow-gold"
    >
      <Card surface="raised" interactive className="space-y-2">
        <Eyebrow>Today&apos;s devotional</Eyebrow>
        <Heading level={2} size="sm">
          {devotional.title}
        </Heading>
        <p className="text-caption text-gold-soft">{devotional.scriptureRef}</p>
        <p className="text-body text-cream-muted">{preview}…</p>
        <p className="pt-1 text-caption text-gold-soft">Read more →</p>
      </Card>
    </Link>
  );
}
