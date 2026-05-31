"use client";

import { useEffect, useRef, useState } from "react";

import { VideoEmbed } from "@/components/media/VideoEmbed";
import {
  Banner,
  Button,
  Eyebrow,
  Heading,
  Input,
  Link,
  Textarea,
} from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useMinistryOwner } from "@/lib/hooks/useMinistryOwner";
import { useWeeklySermon, type WeeklySermon } from "@/lib/hooks/useWeeklySermon";

export default function WeeklySermonAdminPage() {
  const isOwner = useMinistryOwner();
  const { sermon, loading, mutate } = useWeeklySermon();

  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  // Prefill once from the current entry so an owner edits in place rather
  // than starting from a blank form.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || loading || !sermon) return;
    hydrated.current = true;
    setVideoUrl(sermon.videoUrl);
    setTitle(sermon.title);
    setDescription(sermon.description);
  }, [sermon, loading]);

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
        <Banner tone="error">
          Only ministry owners can manage the weekly sermon.
        </Banner>
      </main>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setPublished(false);
    if (!videoUrl.trim() || !title.trim()) {
      setError("A video URL and a title are required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost<WeeklySermon>("/api/admin/weekly-sermon", {
        videoUrl: videoUrl.trim(),
        title: title.trim(),
        description: description.trim(),
      });
      await mutate();
      setPublished(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't publish the sermon. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href="/feed" variant="muted" className="text-caption">
        ← Ministry feed
      </Link>

      <header className="space-y-1">
        <Eyebrow>Weekly sermon</Eyebrow>
        <Heading level={1} size="md">
          This week&apos;s sermon
        </Heading>
        <p className="text-body-sm text-cream-muted">
          Paste a YouTube or Vimeo link. Publishing replaces the current
          week&apos;s sermon for everyone on the home screen.
        </p>
      </header>

      {published && (
        <Banner tone="success">Published. Everyone sees it on Home now.</Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Video URL"
          type="url"
          inputMode="url"
          placeholder="https://youtu.be/…"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          required
        />
        <Input
          label="Title"
          placeholder="Abiding in the Vine"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Textarea
          label="Description"
          placeholder="A sentence or two of context (optional)."
          value={description}
          maxLength={8000}
          rows={4}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Publishing…" : "Publish"}
        </Button>
      </form>

      {videoUrl.trim() && (
        <section className="space-y-2 border-t border-line pt-6">
          <Eyebrow>Preview</Eyebrow>
          <VideoEmbed url={videoUrl.trim()} title={title || "Preview"} />
        </section>
      )}
    </main>
  );
}
