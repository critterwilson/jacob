# ADR 0012 — Admin-approval signup flow + parental-consent gate

**Status:** Accepted (2026-05-17)
**Authors:** admin-approval signup task
**Related:** `frontend/content/legal/privacy.md` § Children, `frontend/content/legal/terms.md` § Who can use JACOB, `docs/data-model.md`.

## Context

Until this change, anyone could sign up for JACOB, verify their email, fill
in the onboarding profile, and immediately participate. Two product
constraints, set by the ministry owner, push us toward a gated signup:

1. **Membership approval.** New accounts should not get full member access
   until a platform admin sees who's signing up and decides whether to let
   them in.
2. **Parental consent for under-18 applicants.** The privacy policy
   (`privacy.md:174`) already documents the requirement; the in-app gate
   was on the launch checklist. We are landing it now. The flow is
   **admin-mediated**, not an automated parent-email-click — the admin
   manually attests that consent was obtained before approving the
   applicant. The owner explicitly chose this simpler model.

Email verification stays unchanged: a Firebase Auth user is created at
signup time, the verification link is sent, and the user lands on the
onboarding form only after `emailVerified === true`. The new gate sits
**after** onboarding-submit, not before email verification.

## Decision

### 1. New `applications/{uid}` collection (not a state on `users/{uid}`)

A pending applicant lives in a new top-level `applications/{uid}` collection,
not as a flag on `users/{uid}`. The `users/{uid}` document is **only**
created when an admin approves the application. Schema:

```jsonc
applications/{uid} = {
  email: string,             // verified at the auth layer
  displayName: string,
  photoURL: string | null,
  dob: "YYYY-MM-DD",         // ISO date; never trust client-side
  isMinor: boolean,          // server-computed from dob at submit
  phone?: string,
  location?: string,
  faithBackground?: string,
  status: "pending" | "approved" | "rejected",
  createdAt: serverTimestamp,
  submittedAt: serverTimestamp,
  decidedAt: serverTimestamp | null,
  decidedBy: uid | null,
  parentalConsentObtained: boolean | null,  // required true for under-18 approvals
  parentalConsentNotes: string,             // admin-supplied free text
  rejectionReason: string,                  // admin-supplied free text on reject
}
```

Why a separate collection, not a flag on `users/{uid}`:

- **Access semantics stay simple.** Today, every read/write path checks
  "does `users/{uid}` exist?" — through `GET /api/users/me/bootstrap` and
  the `jacob-has-profile` cookie. If we created a user doc at signup with
  `status: pending`, every existing access predicate (group membership,
  message authoring, notification fan-out) would have to learn about that
  state. A separate collection means existing code keeps treating
  user-doc presence as the canonical "approved member" signal.

- **Rejections don't pollute `users/{uid}`.** A rejected applicant has an
  application doc with `status: "rejected"` but no user doc; nothing
  downstream has to filter them out.

- **Grandfathering is free.** Pre-existing users already have a user doc,
  so they are automatically "approved" with no migration required for
  access. We do land a small audit-only backfill script that creates
  matching `applications/{uid}` records for the audit trail; the
  backfill is **not** load-bearing for access control.

Mirrors the queue patterns already in the codebase (`moderation_queue`,
`appeals`, `ncmec_cases`). Default-deny in `firestore.rules`; reads and
writes go through `/api/applications/me` (applicant) and
`/api/admin/applications/*` (admin). Admin SDK bypasses rules by design.

### 2. Application is created on onboarding-form submit, after email verification

The flow:

1. **Signup** (`/sign-up`): Firebase Auth user is created (email + password
   or Google). We also collect **date of birth** here as a required field.
   Under-13 applicants are blocked before the auth user is created (we
   refuse to call `createUserWithEmailAndPassword`).
2. **Email verification** (`/verify-email`): unchanged. The page polls the
   Firebase user's `emailVerified` flag.
3. **Onboarding** (`/onboarding`): the profile form takes display name,
   optional fields, **and DOB again** (pre-filled from `sessionStorage`
   handed off from the signup step). DOB is collected twice because the
   signup-time value can be lost across tabs or devices; the onboarding
   value is the authoritative one.
4. **Application submit** (`POST /api/applications/me`): the backend
   computes `isMinor` from the DOB, refuses under-13 with a 422, writes
   the application doc with `status: "pending"`, and the user is
   redirected to `/awaiting-approval`.
5. **Approval wait** (`/awaiting-approval`): a static screen that polls
   `GET /api/applications/me` every 30s. On `approved`, the page navigates
   to `/groups`. On `rejected`, it shows a generic
   "your application was not approved" message with the admin's reason.
6. **Admin review** (`/admin/applications`): the admin sees pending
   applications, the applicant's email + display name + age, a
   parental-consent checkbox + notes textarea (shown only for under-18),
   and Approve / Reject buttons.
7. **Approval** (`POST /api/admin/applications/{uid}/approve`): the backend
   refuses to approve an under-18 application unless
   `parentalConsentObtained === true`. On success, it copies the
   application data into `users/{uid}` (the load-bearing artefact of an
   approved member) and writes an audit-log entry.

DOB is stored only on `applications/{uid}` — not on `users/{uid}`. We keep
`isMinor: boolean` on the user doc (the existing field) but drop the raw
DOB after approval. Data minimisation: we don't need a precise birthdate
for ongoing operation, only the under-18 bit and the admin's consent
record.

### 3. Parental consent: admin attestation, not automated parent-email-click

The owner explicitly chose this simpler model. The admin endpoint
requires the admin to pass `parentalConsentObtained: true` for under-18
applicants; refusing to pass it returns 422. A free-text
`parentalConsentNotes` field lets the admin record how consent was
obtained (phone call, in-person at ministry meeting, signed form on
file, etc.). The audit log captures the attestation.

We deliberately do **not** implement a parent-email-click flow because:

- It would require collecting a parent's email address, adding email
  templates, building a token-redemption page, and handling
  bounces/expiry — a much larger surface.
- The ministry's signup volume is low; the admin has direct contact with
  applicants' parents through the ministry itself.
- The audit-log entry + `parentalConsentNotes` field is enough of a
  paper trail for the privacy-policy commitment.

If signup volume grows, the automated flow is a future iteration. The
data model is forward-compatible: an automated `parentalConsentToken`
sub-collection can be added without changing the existing fields.

### 4. Rejection path: data lingers, no email

A rejected applicant's `applications/{uid}` doc stays in place (with
`status: "rejected"`, `rejectionReason`, `decidedAt`, `decidedBy`).

- The applicant retains their Firebase Auth user — we do **not** delete
  it. They can sign back in and see the rejection screen at
  `/awaiting-approval`.
- We do **not** send a rejection email in v1. The privacy policy only
  promises a parental-consent gate, not a notification surface; the
  applicant sees the rejection in-app when they next sign in. Adding
  rejection email is a follow-up (template + a new SendGrid path), not
  in scope here.
- There is no self-serve "re-apply" path in v1. If an applicant should be
  reconsidered, an admin can manually flip `status` back to `pending` via
  the admin endpoint (an `unreject` operation we may add later); for
  now, this is a manual ops task.

### 5. Grandfathering: presence of `users/{uid}` is the access signal

Existing users (pre-this-PR) already have `users/{uid}` docs and are
automatically treated as approved. There is no migration required for
access. We do land an audit-only backfill script
(`infra/scripts/backfill_applications.py`) that creates
`applications/{uid}` records with `status: "approved"`,
`decidedBy: "system_grandfather"`, `decidedAt: serverTimestamp`. This is
for transparency in the admin queue (every user has a paper trail), not
for gating access.

Pre-existing minor users (`users/{uid}.isMinor === true`) get a
backfilled application with `parentalConsentObtained: null` and a
`grandfathered: true` marker. The admin queue surfaces these with a
warning so the team can decide whether to retroactively collect
consent. We do **not** auto-lock them — that would lock paying users
out of the ministry mid-week, which is a worse outcome than a
documented gap the team can resolve at their own pace.

### 6. DOB collection: required for everyone, not opt-in

Two options were on the table: (a) require DOB for everyone, (b) ask
only when the user self-identifies as 13–17. We chose (a):

- The under-13 gate already deletes the auth account; that path is
  unchanged. Requiring DOB at signup lets us short-circuit earlier
  (before `createUserWithEmailAndPassword`) rather than after, saving
  the user from a wasted email-verification cycle.
- The trust issue with self-selected age groups is real: the existing
  three-radio gate ("18+ / 13–17 / under-13") is easy to lie past. A
  date field is no harder to falsify, but it forces a deliberate input
  the user has to type, which we then check against the actual ToS
  language ("at least 13").
- A precise DOB is more useful for the admin reviewing the application
  than an age bucket — the team can see at a glance whether the
  applicant is 14 or 17 and adjust the parental-consent conversation
  accordingly.

The DOB never lands on `users/{uid}` after approval; only `isMinor`
persists. The raw value stays on `applications/{uid}` for the audit
record.

## What v1 doesn't do

- Send rejection / approval email (in-app status is the only surface).
- Auto-rotate the queue (admin polls the page; no realtime push).
- Allow re-application after rejection (manual admin action only).
- Capture a parent email address or a token-redemption flow for
  parental consent.
- Lock out grandfathered minor users who pre-date this gate.
- Wire a `moderator` custom claim (separate task).
- Expose application data on the public transparency report (only
  aggregate counts may surface there in a future iteration).

## Cost trigger to revisit

- If signup volume exceeds ~10 / day sustained, prioritise an
  automated parent-email-click flow so the admin isn't the bottleneck.
- If rejections become a regular operation (>1 / week), add a
  rejection-email template and surface the rejection in a dedicated
  `/api/users/me/applications` history view.

## Cross-references

- Implementation: `backend/app/routers/applications.py`,
  `backend/app/services/applications.py`,
  `backend/app/models/applications.py`, the admin endpoints in
  `backend/app/routers/admin.py`,
  `frontend/app/admin/applications/page.tsx`,
  `frontend/app/awaiting-approval/page.tsx`,
  `frontend/components/onboarding/ProfileForm.tsx`,
  `frontend/components/auth/SignUpForm.tsx`,
  `firestore/firestore.rules` (the new `applications/{uid}` block),
  `firestore/firestore.indexes.json` (status+createdAt index).
- Migration: `infra/scripts/backfill_applications.py`.
- Policy: `frontend/content/legal/privacy.md` § Children,
  `frontend/content/legal/terms.md` § Who can use JACOB.
