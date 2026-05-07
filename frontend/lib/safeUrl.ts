/**
 * URL-protocol allowlist helpers for any place we render a
 * user/leader-controlled URL into an `<a href>`, `<img src>`, or
 * `<iframe src>` attribute.
 *
 * Centralised here so CodeQL `js/xss-through-dom` recognises the
 * URL-constructor + protocol-allowlist pattern as the sanitiser, and
 * so the policy is consistent across every surface.
 *
 * - `safeHttpUrl`  → links and iframes (http/https only).
 * - `safeImageSrc` → `<img src>` (http/https/blob, plus a
 *                    `data:image/{png,jpeg,gif,webp}` allowlist for
 *                    inline previews — SVG is excluded because
 *                    `<svg>` can carry script).
 */

function tryParse(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function safeHttpUrl(url: string | null | undefined): string | null {
  const parsed = tryParse(url);
  if (!parsed) return null;
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.href;
  }
  return null;
}

const IMAGE_DATA_PREFIXES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
];

export function safeImageSrc(url: string | null | undefined): string | null {
  const parsed = tryParse(url);
  if (!parsed) return null;
  if (
    parsed.protocol === "http:" ||
    parsed.protocol === "https:" ||
    parsed.protocol === "blob:"
  ) {
    return parsed.href;
  }
  if (parsed.protocol === "data:") {
    const path = parsed.pathname.toLowerCase();
    if (IMAGE_DATA_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return parsed.href;
    }
  }
  return null;
}
