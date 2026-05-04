"use client";

// T53 — Open Graph preview card. Image rendered with no-referrer so
// the source page URL doesn't leak to the image host. Image proxy
// via GCS is a follow-up; for v1 we render the OG URL directly.

import type { Unfurl } from "@/components/chat/MessageBody";

export function UnfurlCard({ unfurl }: { unfurl: Unfurl }) {
  const hasMetadata =
    unfurl.title || unfurl.description || unfurl.imageUrl || unfurl.siteName;

  return (
    <a
      href={unfurl.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded border border-gray-200 bg-gray-50 p-2 hover:bg-gray-100"
    >
      {unfurl.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={unfurl.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        {unfurl.siteName && (
          <p className="truncate text-xs uppercase tracking-wide text-gray-500">
            {unfurl.siteName}
          </p>
        )}
        <p className="truncate text-sm font-medium text-gray-800">
          {unfurl.title ?? unfurl.url}
        </p>
        {unfurl.description && (
          <p className="line-clamp-2 text-xs text-gray-600">
            {unfurl.description}
          </p>
        )}
        {!hasMetadata && (
          <p className="text-xs text-gray-500">{unfurl.url}</p>
        )}
      </div>
    </a>
  );
}
