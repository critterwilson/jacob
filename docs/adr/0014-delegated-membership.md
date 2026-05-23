# ADR 0014 — Delegated, group-based membership approval

**Status:** Accepted (2026-05-23)
**Authors:** delegated-membership rework
**Supersedes:** [ADR 0012](0012-admin-approval-signup.md)
**Related:** `docs/data-model.md`, `firestore/firestore.rules`,
`backend/app/routers/admin.py`, `backend/app/routers/discover.py`,
PR #284 (existing join-request infrastructure that this ADR extends).

## Context

ADR 0012 introduced a single platform-wide admin-approval queue: every
new account submitted an `applications/{uid}` doc that the platform
admin (the "Organization owner") had to approve before a `users/{uid}`
doc was created and any in-app access was granted. That queue was the
only gate between a signed-up email and being able to do anything.

That model has not held up:

1. **It does not match the ministry's mental model.** The owner thinks
   in terms of groups, not platform members. Approving every single
   sign-up centrally puts the owner on the critical path for routine
   joins that group leaders are better placed to vet.
2. **A single queue conflates two very different decisions.** Vouching
   for a new group leader (who can then admit members) is a much bigger
   trust call than vouching for a new adult member joining one
   already-vetted group. ADR 0012 made them the same call.
3. **It blocks parts of the app that don't need a vouch at all.**
   Public cross-group boards, group discovery, and "request to join" are
   surfaces that benefit from being open to any signed-in user. ADR 0012
   parked applicants on a static `/awaiting-approval` screen.
4. **Minors need a higher bar than the rest, not the same bar.** Under
   ADR 0012, the admin attested parental consent on platform-wide
   approval. With delegated approval, leaders would otherwise be able
   to approve a minor into their group — that is the wrong locus for a
   safety-weighted decision.

The ministry owner's original vision is a *delegated* model, by analogy
with a jiu-jitsu tournament: a competitor picks a registered gym (vetted
upstream) or competes "unaffiliated". The platform owner vets *gyms*
(group leaders); each gym (group leader) vets its own competitors
(members). Minors are special and bubble back to the platform owner.

## Decision

### 1. Open self-signup; `users/{uid}` created on onboarding submit

Anyone with a verified email can complete onboarding and receive a
`users/{uid}` document — no platform-wide approval queue. The
onboarding form continues to collect `dob`; the backend computes
`isMinor` from it and persists `dob` to `users/{uid}/private/profile`
(sensitive PII, owner-readable only). Under-13 is refused at submit-
time exactly as before.

`users/{uid}` existence remains the load-bearing "approved platform
member" signal — every authenticated `/api/*` endpoint that calls
`get_current_user` continues to assume it. The `jacob-has-profile`
cookie keeps gating the Next.js middleware redirect to `/onboarding`.

The `/awaiting-approval` route is removed. New signups land at `/home`
in an *unaffiliated* state immediately after onboarding submit.

### 2. The "unaffiliated" tier — limited access, not no access

An unaffiliated user has a `users/{uid}` doc but no group memberships.
Without changing any access dep, the existing surface already gives them
what the owner asked for:

| Surface | Access predicate | Unaffiliated user can use? |
|---|---|---|
| Cross-group boards (`/boards`) | `get_current_user` | ✅ |
| Discover (`/discover`) | `get_current_user` | ✅ |
| Request to join a group | `require_not_banned` | ✅ |
| Group chat / sermons / devotionals / events | `require_member` | ❌ (until approved into a group) |
| Group invite landing for adult | invite-consume | ✅ — auto-join (the leader is vouching by inviting) |
| Group invite landing for minor | invite-consume | ❌ — escalates to owner queue |

No new permission predicate is introduced. The "unaffiliated" state is
the absence of any `groups/{gid}/members/{uid}` membership doc — a
property of the data, not a new field.

### 3. Group leader applications — owner approves

Becoming a group leader requires owner approval. Two paths:

- **Direct.** The owner can `POST /api/groups` to create a group with
  themselves as leader, or designate any user as leader via an existing
  membership write. `POST /api/groups` becomes restricted to
  `require_ministry_owner` (admin is a strict superset and also passes).
- **Application.** A non-owner submits a leader application via
  `POST /api/leader-applications`. The application carries the proposed
  group name, description, audience, and a short motivation. The owner
  reviews the pending queue at `/admin/leader-applications` and either
  approves (the backend then creates the group atomically with the
  applicant as leader) or rejects (with a reason).

A new top-level collection `leader_applications/{appId}` holds the
queue. Default-deny in `firestore.rules`; all access goes through
`/api/leader-applications` (applicant) and `/api/admin/leader-applications*`
(owner). Schema in `docs/data-model.md`.

### 4. Group join-requests — leaders approve adults, owners approve minors

Join-requests reuse the existing `groups/{gid}/joinRequests/{uid}`
collection from PR #284. Two new fields decide which queue a request
lands in:

- `requiresOwnerReview: boolean` — set to `true` when the requester is a
  minor (`users/{uid}.isMinor == true`).
- `isMinor: boolean` — denormalised onto the request at submit time so
  the owner queue surface doesn't have to re-read every user doc.

Three additional fields support the parental-consent attestation:

- `inviteCode: string | null` — set when the join-request was created
  from an invite-link landing (see §5).
- `parentalConsentObtained: boolean | null` — set on owner approval.
- `parentalConsentNotes: string` — owner-supplied free text, mirrors
  ADR 0012 § 3.

**Leader endpoints (existing, behavior tightened):**

- `POST /api/groups/{gid}/join-requests/{uid}/approve` — refuses with
  `403 minor_owner_review_required` if the join request has
  `requiresOwnerReview == true`. A leader **cannot** approve a minor.
  This is the load-bearing safety rule.
- `GET /api/groups/{gid}/join-requests` — filters out
  `requiresOwnerReview == true` rows from the leader's view. A leader
  cannot see a pending minor as actionable; the owner queue handles it.

**Owner endpoints (new):**

- `GET /api/admin/minor-join-requests` — collection-group query for
  `joinRequests where requiresOwnerReview == true && status == "pending"`,
  joined with the group name and a thin user view (displayName, age,
  photoURL). Requires `require_ministry_owner`.
- `POST /api/admin/groups/{gid}/join-requests/{uid}/approve` — owner
  approves a minor's request. Body **requires**
  `parentalConsentObtained: true`; refuses with 422 otherwise. Approval
  consumes any persisted `inviteCode` (see §5).
- `POST /api/admin/groups/{gid}/join-requests/{uid}/reject` — owner
  rejects with a reason.

The minor-only restriction on the owner endpoint is symmetric to the
adult-only restriction on the leader endpoint — the two paths cannot
silently swap behaviour.

### 5. Invites: leader-vouched for adults, escalated for minors

The existing invite-consume endpoint (`POST /api/groups/join`) is the
"adult arrived via leader's invite" path: a valid invite from a leader
is treated as the leader's vouch, and the adult is auto-added as a
member. Same code path as today.

For minors the invite does **not** bypass owner approval. The consume
path branches on `users/{uid}.isMinor`:

- **Adult:** `consume_invite()` runs to completion — invite useCount
  increments, member doc is created, member count bumps. Unchanged.
- **Minor:** the invite is **not** consumed. Instead, a join-request is
  written to `groups/{gid}/joinRequests/{uid}` with
  `requiresOwnerReview: true`, `isMinor: true`, and `inviteCode: <CODE>`
  preserved. The owner approval endpoint runs `consume_invite()` at
  decision time, which is when the invite useCount finally moves. If
  the invite has since expired or maxed out, the owner's approval still
  goes through but the join-request audit records the failed consume —
  matching the pattern in ADR 0012 § approve invite-outcome handling.

An invite never auto-joins a minor. This is the second load-bearing
safety rule.

### 6. ADR 0012 retirement

ADR 0012 is **Superseded**. The `applications/{uid}` collection is kept
in the data model for the legacy queue (existing pending applications
need to be drained manually by the owner via the legacy admin UI, which
remains in place for backward compat). The submit endpoint
`POST /api/applications/me` returns `410 Gone` for any new caller. The
legacy admin list/approve/reject endpoints stay reachable so the owner
can clear the residual queue.

No data migration is automated in this PR: existing pending applications
are few (per the ADR 0012 "low volume" note) and the owner can clear
them by hand. A self-serve migration script can be added later if
needed.

### 7. What this ADR does not do

- Per-org owners. The platform has a single ministry-owner role; multi-
  tenant org-scoped owners (one per org) are a future iteration.
- Automated parent-email consent. The attestation model from ADR 0012
  § 3 is reused — the owner ticks a box and records notes. The
  data shape is forward-compatible with a future token-redemption flow.
- Removing the legacy `applications/{uid}` collection. Leaving the
  documents in place preserves the audit trail; removing them is a
  scheduled cleanup, not a model change.
- Notifications when a leader application is approved/rejected, or a
  join-request is decided. Those follow the existing notification
  patterns and can be added incrementally without reshaping this ADR.

### 8. Failure modes we deliberately accept

- **Leader sees nothing for a pending minor.** A minor who requests to
  join a group will not appear in the leader's queue. The leader will
  not know the request exists. This is the right default: the leader
  has no role in the decision, and surfacing the request as a
  read-only "pending owner review" tile risks the leader nudging the
  owner or, worse, treating the queue as a signal of legitimate
  interest from the minor. The owner queue is the only surface.
- **Bypassing the gate requires forging a custom claim.** Custom claims
  are signed by Firebase Auth; the backend re-verifies the token on
  every request. There is no client-side path to grant
  `ministry_owner` to oneself.
- **An adult could lie about their DOB.** Same caveat as ADR 0012 § 6.
  The user has to type a date that puts them at or above 18; that is
  no easier or harder to falsify than the current radio-button gate.
  The DOB is owner-readable on the user's private subcollection so
  retroactive review is possible.

## Cross-references

- Implementation: `backend/app/routers/admin.py` (owner queues),
  `backend/app/routers/leader_applications.py` (new),
  `backend/app/routers/discover.py` (leader join-request approve
  rewritten to refuse minors), `backend/app/routers/groups.py`
  (create-group restricted to owner), `backend/app/services/invites.py`
  (minor branch), `backend/app/routers/users.py` (onboarding submit
  rewritten to bypass applications),
  `frontend/app/(authed)/admin/leader-applications/page.tsx`,
  `frontend/app/(authed)/admin/minor-reviews/page.tsx`,
  `frontend/app/(authed)/leader-application/page.tsx`,
  `frontend/components/home/UnaffiliatedBanner.tsx`,
  `frontend/app/onboarding/page.tsx` (simplified),
  `frontend/middleware.ts` (awaiting-approval entry removed).
- Rules + indexes:
  `firestore/firestore.rules` (`leader_applications` block),
  `firestore/firestore.indexes.json` (composite + CG indexes).
- Tests: `backend/tests/routers/test_leader_applications.py`,
  `backend/tests/routers/test_join_requests_minor.py`,
  `firestore/tests/rules.test.ts` updates.
