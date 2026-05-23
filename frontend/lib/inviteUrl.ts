/**
 * Returns the full invite link for a given code.
 *
 * Prefers NEXT_PUBLIC_APP_URL when set at build time (for CDN or custom-domain
 * deployments where the serving origin may not match). Falls back to
 * window.location.origin so the URL automatically tracks wherever the app is
 * actually deployed — staging URL today, custom domain the moment it goes live
 * — with zero config change.
 */
export function getInviteUrl(code: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/join?code=${code}`;
}
