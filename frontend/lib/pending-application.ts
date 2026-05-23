/**
 * sessionStorage hand-off for values collected at signup time that the
 * onboarding form / application submit needs but can't (or shouldn't)
 * carry on the URL.
 *
 * ADR 0012 § 6: DOB is collected on the signup form so the under-13
 * gate fires before the Firebase Auth user is created. The
 * authoritative application doc is created later, from the onboarding
 * form, so we need to plumb the value across the verify-email page
 * without putting it in a query string (PII in URL bars + browser
 * history) or a long-lived cookie (it'd outlive the relevant tab).
 *
 * The invite code (when the user arrived via `/join?code=…`) is
 * stashed alongside DOB so it survives the signup → verify-email →
 * onboarding hops within the tab. The authoritative persistence is
 * the `inviteCode` field on the `applications/{uid}` doc — the
 * sessionStorage value only needs to live until the application is
 * submitted. After admin approval (potentially days later, in a
 * different session), the backend consumes the code from the
 * application doc, so sessionStorage doesn't have to survive that.
 *
 * Per-tab sessionStorage is the right scope: it survives the
 * verify-email redirect within the same tab and is cleared by the
 * onboarding submit. If the user verifies email from a different
 * device or clears storage, the onboarding form falls back to its
 * own DOB input — the invite-code path just degrades to "approved
 * without auto-join," which the user can recover from by re-opening
 * the invite link.
 */

const DOB_KEY = "jacob-pending-dob";
const INVITE_KEY = "jacob-pending-invite-code";

export function stashPendingDob(dob: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DOB_KEY, dob);
  } catch {
    // sessionStorage can throw in private-browsing modes; the
    // onboarding form is the authoritative input so this is fine.
  }
}

export function readPendingDob(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(DOB_KEY);
  } catch {
    return null;
  }
}

export function clearPendingDob(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DOB_KEY);
  } catch {
    // ignore
  }
}

/**
 * Invite codes are 8 base32 chars today (see
 * `backend/app/services/invites.py`), but be conservative on length
 * to allow future schemes. Normalize to uppercase to match the join
 * form's coercion.
 */
const INVITE_CODE_RE = /^[A-Z0-9]{1,16}$/;

export function stashPendingInviteCode(code: string): void {
  if (typeof window === "undefined") return;
  const normalized = code.trim().toUpperCase();
  if (!INVITE_CODE_RE.test(normalized)) return;
  try {
    window.sessionStorage.setItem(INVITE_KEY, normalized);
  } catch {
    // sessionStorage unavailable — invite will be lost across the
    // signup hop. The user can still join via /join after approval.
  }
}

export function readPendingInviteCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(INVITE_KEY);
    if (!value) return null;
    const normalized = value.trim().toUpperCase();
    return INVITE_CODE_RE.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function clearPendingInviteCode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // ignore
  }
}
