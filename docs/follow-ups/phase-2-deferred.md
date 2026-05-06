# Phase 2 review — deferred findings

Items from `docs/reviews/codebase-review-phase-2-2026-05.md` that were too
large for the single cleanup PR (`fix: Address Medium and Low findings from
Phase 2 review`). Each entry explains what's needed.

---

## M4 — `announce_message` fan-out blocks the request thread

**Where:** `backend/app/routers/groups.py` — `announce_message` endpoint.
**Problem:** `members.stream()` + `bulk_write_notifications` runs synchronously
on the request for potentially 1 000+ members, risking a Cloud Run timeout.
**What's needed:** Move fan-out to a Cloud Function trigger on `announcedAt`
field write. The endpoint sets `announcedAt = SERVER_TIMESTAMP` and returns
immediately; the trigger fans out notifications and writes the audit row.
This is a non-trivial architectural change (new trigger file, new Firestore
field, updated security rules, emulator test).

---

## M16 — `_events` / `_reaction_events` idempotency markers grow unbounded — **done**

Shipped in `chore: Firestore TTL on idempotency markers (M16)`.

Each marker write now includes `expiresAt = now + 7 days` (helper at
`functions/src/services/eventMarkers.ts`). TTL is enabled per-collection-group
on `expiresAt` via `infra/firestore-ttls.sh`, which the user runs once per
project — see `docs/runbooks/firestore-ttls.md`. Coverage extended to all six
idempotency-marker collection groups (`_events`, `_reaction_events`,
`_index_events`, `_post_events`, `_reply_events`, `_member_events`) since they
share an identical lifecycle.

---

## L9 — Sentry does not capture server-side (SSR) exceptions

**Where:** `frontend/components/SentryInit.tsx` — `initSentry()` only runs
inside `useEffect`, so server-render errors are never captured.
**What's needed:** Add `instrumentation.ts` (Next.js 14 App Router) or
`sentry.server.config.ts` following `@sentry/nextjs` guidance to initialise
Sentry for the Node.js runtime. Tests: verify a server component `throw` is
captured in Sentry dev mode.

---

## L11 — Typesense Docker image pinned by mutable tag, not digest — **done**

Shipped in `chore: pin Typesense image by SHA digest (L11)`.

`infra/typesense.tf` now requires both `typesense_image_tag` and
`typesense_image_digest` — terraform refuses to apply without a digest
matching `^sha256:[0-9a-f]{64}$`. The default in
`infra/terraform.staging.tfvars.example` is `27.1` pinned to its real
upstream digest; the previous repo state pinned `0.27.0`, which was a typo
for `27.x` (Docker Hub has no `0.27.0` tag). Dependabot has a forward-looking
docker entry on `/infra` with `reviewers: [critterwilson]`, but Dependabot
doesn't natively scan Terraform image references — the operational mechanism
is the digest-rotation runbook at `docs/runbooks/typesense-image-pin.md`.

User's manual step: run `terraform plan` + `terraform apply` once the PR
lands. `plan` should show a single `image` change on the typesense Cloud
Run service and nothing else.

---

## L14 — `_held/` quarantine GCS prefix has no terminal Delete lifecycle rule

**Where:** `infra/buckets.tf:101-110` — only a SetStorageClass-to-COLDLINE rule
at age 365 days; no Delete rule.
**What's needed:** Add a Delete lifecycle rule at age 2 557 days (≈7 years) and
document the retention policy in `docs/runbooks/media-moderation.md`.
Requires legal/counsel sign-off per existing comment; file a ticket before
implementing.

---

## C1 — Reaction subcollection cleanup on account deletion

**Where:** `backend/app/services/deletion.py:_delete_reactions_by_user` is
currently a no-op that returns 0.

**Why deferred:** the reaction docs live at
`groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}`. The leaf
subcollection name `users` collides with the top-level `users` collection
at the collection-group level, and the Python Admin SDK doesn't expose a
clean by-document-id filter for collection-group queries. Two viable fixes:

1. Denormalise a `userUid` field on the reaction doc and CG-query by
   that. Requires updating the reaction toggle endpoint
   (`POST /api/groups/{gid}/messages/{mid}/reactions/{slug}` in
   `backend/app/routers/messages.py`) to write the field; backfill via
   a one-shot script.
2. Maintain a `users/{uid}/reactions/{gid}_{mid}_{slug}` index doc on
   every reaction write. One extra Firestore write per reaction; cheap
   delete on account finalize.

**Impact today:** stale reaction docs contain only `reactedAt` (no PII
beyond a timestamp). The `reactionCounts` map on the parent message
stays slightly inflated for any message the deleted user reacted to
until a re-index. No GDPR violation; cosmetic UI inconsistency only.
