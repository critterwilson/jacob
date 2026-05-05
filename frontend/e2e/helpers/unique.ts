import { randomUUID } from "node:crypto";

const PREFIX = "jacob-e2e";
const MAILINATOR_DOMAIN = "mailinator.com";

/**
 * Returns a fresh, unique mailinator inbox + a per-run human label.
 *
 * The local part follows `${PREFIX}-${shortId}` so test artefacts in the
 * public mailinator inbox remain easy to grep for during triage. We use
 * the first 12 chars of a random UUID — enough entropy to avoid collisions
 * inside a CI run while keeping URLs short.
 */
export function uniqueEmail(): { email: string; localPart: string } {
  const shortId = randomUUID().replace(/-/g, "").slice(0, 12);
  const localPart = `${PREFIX}-${shortId}`;
  return { email: `${localPart}@${MAILINATOR_DOMAIN}`, localPart };
}

export function uniqueLabel(scope: string): string {
  const shortId = randomUUID().slice(0, 8);
  return `${scope}-${shortId}`;
}
