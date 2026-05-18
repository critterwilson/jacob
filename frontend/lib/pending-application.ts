/**
 * sessionStorage hand-off for the DOB collected at signup time.
 *
 * ADR 0011 § 6: we collect DOB on the signup form so the under-13
 * gate fires before the Firebase Auth user is created. The
 * authoritative application doc is created later, from the onboarding
 * form, so we need to plumb the value across the verify-email page
 * without putting it in a query string (PII in URL bars + browser
 * history) or a long-lived cookie (it'd outlive the relevant tab).
 *
 * Per-tab sessionStorage is the right scope: it survives the
 * verify-email redirect within the same tab and is cleared by the
 * onboarding submit. If the user verifies email from a different
 * device or clears storage, the onboarding form falls back to its
 * own DOB input — it has the validation either way.
 */

const KEY = "jacob-pending-dob";

export function stashPendingDob(dob: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, dob);
  } catch {
    // sessionStorage can throw in private-browsing modes; the
    // onboarding form is the authoritative input so this is fine.
  }
}

export function readPendingDob(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingDob(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
