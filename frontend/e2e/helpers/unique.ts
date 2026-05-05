import { randomUUID } from "node:crypto";

const PREFIX = "jacob-e2e";
// Mailinator is no longer scraped (the public inbox was unreachable from
// CI runner IPs). The domain is kept only because Firebase Auth still
// auto-sends a verification email on signup; mailinator.com swallows it
// silently into a public inbox we don't read. Email verification + reset
// links are now obtained via the Firebase Admin SDK — see firebaseAdmin.ts.
const TEST_EMAIL_DOMAIN = "mailinator.com";

/**
 * Returns a fresh, unique test email + a per-run human label.
 *
 * The local part follows `${PREFIX}-${shortId}` so test artefacts remain
 * easy to grep for during triage (in Firebase Auth + downstream Firestore).
 * We use the first 12 chars of a random UUID — enough entropy to avoid
 * collisions inside a CI run while keeping the address short.
 */
export function uniqueEmail(): { email: string; localPart: string } {
  const shortId = randomUUID().replace(/-/g, "").slice(0, 12);
  const localPart = `${PREFIX}-${shortId}`;
  return { email: `${localPart}@${TEST_EMAIL_DOMAIN}`, localPart };
}

export function uniqueLabel(scope: string): string {
  const shortId = randomUUID().slice(0, 8);
  return `${scope}-${shortId}`;
}
