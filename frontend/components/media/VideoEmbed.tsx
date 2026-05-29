"use client";

import { ButtonLink } from "@/components/ui";
import { safeHttpUrl } from "@/lib/safeUrl";

/**
 * Inline YouTube / Vimeo embed.
 *
 * Reuses the same URL parsing the backend sermon plumbing uses
 * (`youtube_video_id`) — we resolve a watch/short/share URL to the
 * provider's own embed iframe rather than shipping a custom player.
 * The constructed embed URL is run through `safeHttpUrl` (the shared
 * XSS-allowlist sanitiser) before it touches `src`. Anything we can't
 * map to a known provider falls back to a "Watch" link.
 */

function youtubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  const isYouTube =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com";
  if (!isYouTube) return null;
  let candidate = "";
  if (host === "youtu.be") {
    candidate = u.pathname.replace(/^\/+/, "").split("/")[0];
  } else if (u.pathname === "/watch") {
    candidate = u.searchParams.get("v") ?? "";
  } else if (u.pathname.startsWith("/embed/")) {
    candidate = u.pathname.slice("/embed/".length).split("/")[0];
  } else if (u.pathname.startsWith("/shorts/")) {
    candidate = u.pathname.slice("/shorts/".length).split("/")[0];
  }
  return /^[a-zA-Z0-9_-]{6,15}$/.test(candidate) ? candidate : null;
}

function vimeoId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  if (host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    return m ? m[1] : null;
  }
  if (host === "vimeo.com" || host === "www.vimeo.com") {
    const m = u.pathname.match(/^\/(\d+)/);
    return m ? m[1] : null;
  }
  return null;
}

function embedSrc(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const yt = youtubeId(parsed);
  if (yt) return safeHttpUrl(`https://www.youtube.com/embed/${yt}`);
  const vm = vimeoId(parsed);
  if (vm) return safeHttpUrl(`https://player.vimeo.com/video/${vm}`);
  return null;
}

export function VideoEmbed({ url, title }: { url: string; title?: string }) {
  const src = embedSrc(url);

  if (src) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-line bg-black shadow-raise">
        <iframe
          src={src}
          title={title ?? "Video"}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  // Unknown provider — link out rather than risk embedding an arbitrary
  // origin in an iframe.
  const safeLink = safeHttpUrl(url);
  if (!safeLink) return null;
  return (
    <div className="rounded-lg border border-dashed border-line bg-ink-raised px-4 py-6 text-center">
      <p className="mb-3 text-body-sm text-cream-muted">
        This video can&apos;t be embedded here.
      </p>
      <ButtonLink
        href={safeLink}
        target="_blank"
        rel="noopener noreferrer"
        variant="primary"
      >
        Watch ↗
      </ButtonLink>
    </div>
  );
}
