"use client";

// T53 — Open Graph preview card. Image rendered with no-referrer so
// the source page URL doesn't leak to the image host. Image proxy
// via GCS is a follow-up; for v1 we render the OG URL directly.

import type { Unfurl } from "@/components/chat/MessageBody";
import { safeHttpUrl, safeImageSrc } from "@/lib/safeUrl";

export function UnfurlCard({ unfurl }: { unfurl: Unfurl }) {
  const safeUrl = safeHttpUrl(unfurl.url);
  const safeImageUrl = safeImageSrc(unfurl.imageUrl);
  if (!safeUrl) return null;
  const hasMetadata =
    unfurl.title || unfurl.description || safeImageUrl || unfurl.siteName;

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "flex gap-3 rounded border border-line bg-ink-overlay p-2 " +
        "transition-colors duration-fast hover:bg-ink-raised " +
        "focus:outline-none focus-visible:shadow-glow-gold"
      }
    >
      {safeImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeImageUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        {unfurl.siteName && (
          <p className="truncate text-caption uppercase tracking-wide text-cream-muted">
            {unfurl.siteName}
          </p>
        )}
        <p className="truncate text-body-sm font-medium text-cream">
          {unfurl.title ?? unfurl.url}
        </p>
        {unfurl.description && (
          <p className="line-clamp-2 text-caption text-cream-muted">
            {unfurl.description}
          </p>
        )}
        {!hasMetadata && (
          <p className="text-caption text-cream-muted">{unfurl.url}</p>
        )}
      </div>
    </a>
  );
}
