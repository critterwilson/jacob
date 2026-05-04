# ADR 0007 — Org model (T54)

**Status:** Accepted (2026-05-04)
**Authors:** T54 implementation pass
**Supersedes / depends on:** ADR 0001 (rate limit strategy),
ADR 0003 (collection-group memberships), the M6 data-layer migration plan.

## Context

JACOB Phases 1 and 2 modelled groups as flat top-level resources owned
by their leader(s). The Phase 3 product expansion (multi-tenant
churches, the BJJ vertical, branded workspaces, org-level analytics,
NCMEC scope, the transparency report) all need a tier above groups.
We need an "org" — a church, a ministry network, a BJJ school —
that owns one or more groups, has its own admins, and can be
addressed as a unit by the dashboard, the moderation UI, and the
transparency surface.

## Decision

Add a new top-level resource `orgs/{orgId}` with the following
shape:

```ts
orgs/{orgId}                            // single doc
orgs/{orgId}/admins/{uid}               // platform-of-orgs admin set
orgs/{orgId}/members/{uid}              // denormalized membership
orgs/{orgId}/invites/{inviteId}         // org-level invites (Phase 3.5)

groups/{gid}.orgId: string | null       // backward-compatible null

org_slugs/{slug}                        // unique-key reservation
org_consent_tokens/{token}              // attach-flow consent
```

Backward compatibility is the load-bearing decision: every existing
group has `orgId = null`, no Phase 1/2 code path treats `orgId` as
required, and the rules-and-services org widening only fires when
`orgId != null`.

### Member denormalization

"Member of any group in the org" is the natural definition of org
membership. Querying it live (collection-group `members` filtered by
parent.orgId) is expensive; we maintain `orgs/{orgId}/members/{uid}`
through `onMemberWrite` (extended). The doc carries `groupIds: string[]`
so leaving one of N groups inside the org doesn't drop org membership.

The trigger uses two independent idempotency markers (one for the
T22 leader-count update, one for the T54 mirror) so a failure in
either does not block the other. Service-layer attach/detach also
back-fills, so any drift is repaired the next time the surface is
exercised.

### Slug uniqueness

`org_slugs/{slug}` doc holds `{orgId}`. `reserve_slug` does
`get → create`; the Firestore single-doc `create()` semantic gives us
an at-most-one guarantee without a transaction. Slugs are also the
T55 subdomain claim, so the regex (`[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?`)
matches the DNS label restrictions, and a `RESERVED_SLUGS` constant
filters infrastructure subdomains (`api`, `www`, `admin`, …).

### Consent flow

When an org admin attaches an existing group:

1. If the org admin is the *only* leader of that group: proceed
   immediately. (Common case for one-pastor churches.)
2. Else if a valid `consentToken` was supplied: consume + proceed.
3. Else: issue a token, email each leader with the code, and return
   409 `consent_required`. The org admin then re-issues the request
   with the code their leader forwarded.

Tokens live in `org_consent_tokens/{token}`, are 32-byte URL-safe
random, expire in 60 minutes, are single-use, and are marked
`consumedAt: serverTimestamp` inside the consume transaction. We
deliberately do not require *unanimous* consent across leaders in v1;
the spec calls that out as Phase 3.5 work if a real org asks for it.

### Last-admin invariant

`remove_admin` refuses if the target is the only remaining admin.
Mirrors T22's leader-count rule but lives in the service layer
because the rule engine can't enumerate a subcollection.

### Audience guard on attach

A `christian` org cannot absorb a `bjj` group, and vice versa. The
sticker sets and brand voice (T56) wouldn't make sense in either
group; better to reject up front. The guard lives in
`orgs_service.attach_group`.

## M6 reconciliation

The original spec assumed clients would `onSnapshot` the
`orgs/{orgId}` doc (and the `admins`, `members`, `invites`
subcollections). M6 is in: clients no longer access Firestore
directly. So we:

* Lock every `orgs/*` rule path at `allow read, write: if false`;
  the Admin SDK bypasses these by design.
* Route every read through `/api/orgs/{orgId}*`. Authorization is
  enforced in the handler via `_require_org_admin` /
  `_require_org_member_or_admin`.
* Drop the rule-engine P12 widening (org-admin acts as group-leader
  in firestore.rules predicates). The backend authorization layer
  performs the same widening at the handler level — it's the
  authoritative trust boundary post-M6.

This is a deliberate scoping decision. If a future migration ever
puts clients back on Firestore, the rule shapes documented in the
spec still apply (and the audit trail makes the gap visible).

## Billing fields placeholder

`orgs/{orgId}.billing = { tier: 'free', customerId: null, status: 'active' }`
ships even though Phase 3 has no paid tier. Reasoning: when paid
tiers (Phase 4) land, the doc shape doesn't reshape. The fields are
not read by any Phase 3 surface.

## What we explicitly didn't do

* **Lobby group auto-creation on org create.** The spec calls for the
  initial admin to be the leader of a default "lobby" group. We
  leave this to a follow-up (the org admin creates the lobby manually
  in v1) so this PR can ship without modifying the groups router.
* **Org-level invites router (`POST /api/orgs/{orgId}/invites`).**
  The schema reserves the path; the endpoint is Phase 3.5 work.
* **Custom domain / branding fields.** Owned by T55 (next ticket).
* **AI policy toggles UI.** The fields exist in the schema; the
  T43–T47 tickets are parked, so no UI surface today.

## Consequences

Positive:

* Every Phase 3 multi-tenant surface (T55 custom domains, T56 BJJ,
  T60 dashboards, T63 NCMEC scope, T65 transparency) has an org id
  to scope by.
* Phase 1/2 surfaces are unaffected (`orgId = null` short-circuits
  every new check).

Negative:

* `onMemberWrite` is now load-bearing for two concerns. The split
  idempotency markers and per-concern transactions limit blast
  radius; if either fails, the other still completes.
* `dashboard_for` does an O(orgs.groups + moderation_queue.pending)
  scan. Acceptable at v1 scale (a pilot org has a handful of groups
  and a small queue); we'll move to BigQuery aggregates when T60
  wires the rest of the dashboard.

## Migration / rollout

* Rules and indexes ship in this PR.
* `groups/{gid}.orgId` defaults to absent; the new
  `orgs.orgId == X` query returns nothing for unaffiliated groups,
  matching pre-T54 behavior.
* Feature-flagged behind `orgs_enabled` (T58). Default 0%; cohort
  the first pilot org admin via `cohorts.uids` to dogfood.
* Provisioning the first org goes through
  `infra/scripts/seed_pilot_org.py` once a pilot is identified.
