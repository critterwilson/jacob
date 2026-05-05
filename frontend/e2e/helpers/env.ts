/**
 * Resolves the Playwright baseURL and refuses to run against anything that
 * looks like production. The default target is staging Firebase Hosting.
 *
 * Override with PLAYWRIGHT_BASE_URL=<url> for a local dev server or a PR
 * preview channel. The production-guard heuristic blocks `jacob.app`,
 * `app.jacob.*`, and any URL the operator confirmed as prod via the
 * `JACOB_E2E_PRODUCTION_GUARD_DISABLED` escape hatch (deliberately verbose
 * so it does not get flipped on by accident).
 */
const STAGING_DEFAULT =
  "https://jacob-frontend--jacob-staging-494515.us-central1.hosted.app";

const PROD_PATTERNS: RegExp[] = [
  /^https?:\/\/jacob\.app(?:[/:?#]|$)/i,
  /^https?:\/\/(?:www|app)\.jacob\.app(?:[/:?#]|$)/i,
  /^https?:\/\/jacob-prod(?:[-./:?#]|$)/i,
];

export function resolveBaseURL(): string {
  const raw = process.env.PLAYWRIGHT_BASE_URL ?? STAGING_DEFAULT;
  const url = raw.replace(/\/+$/, "");

  if (process.env.JACOB_E2E_PRODUCTION_GUARD_DISABLED === "1") {
    return url;
  }

  for (const pattern of PROD_PATTERNS) {
    if (pattern.test(url)) {
      throw new Error(
        `Refusing to run E2E tests against what looks like production (${url}). ` +
          "If this is wrong, set JACOB_E2E_PRODUCTION_GUARD_DISABLED=1 explicitly.",
      );
    }
  }

  return url;
}

export function resolveApiURL(): string {
  return (
    process.env.PLAYWRIGHT_API_URL ??
    "https://jacob-backend-7fk543coqq-uc.a.run.app"
  ).replace(/\/+$/, "");
}
