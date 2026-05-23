/**
 * Validate a `?next=` post-auth redirect destination.
 *
 * Returns the value if it is a same-origin path (starts with a single
 * `/`, and not `//` or `/\` which browsers normalize to other origins).
 * Returns `null` for any other shape — absolute URLs, protocol-relative
 * URLs, missing values, or non-strings — so callers can pick their own
 * default. This is the small safety gate that keeps `/sign-in?next=…`
 * from being turned into an open-redirect into `https://evil.example`.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length === 0) return null;
  if (!next.startsWith("/")) return null;
  // `//foo` is protocol-relative; `/\foo` collapses to a path on some
  // engines but other browsers route it as a host. Reject both.
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
