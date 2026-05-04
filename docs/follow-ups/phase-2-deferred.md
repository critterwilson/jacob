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

## M16 — `_events` / `_reaction_events` idempotency markers grow unbounded

**Where:** `functions/src/onMessageWrite.ts:106`, `onMemberWrite.ts:77`,
`onReactionWrite.ts:35`, `onMessageIndex.ts`.
**Problem:** One permanent Firestore doc per write event under each parent.
Over a year of activity, every message accumulates a large `_events`
subcollection.
**What's needed:** Enable Firestore per-document TTL on `processedAt + 7 days`
for the `_events` and `_reaction_events` collections. Requires a Firestore TTL
policy (set via `firebase.json` or `gcloud firestore fields ttls create`) plus
documentation in `docs/data-model.md`.

---

## L9 — Sentry does not capture server-side (SSR) exceptions

**Where:** `frontend/components/SentryInit.tsx` — `initSentry()` only runs
inside `useEffect`, so server-render errors are never captured.
**What's needed:** Add `instrumentation.ts` (Next.js 14 App Router) or
`sentry.server.config.ts` following `@sentry/nextjs` guidance to initialise
Sentry for the Node.js runtime. Tests: verify a server component `throw` is
captured in Sentry dev mode.

---

## L11 — Typesense Docker image pinned by mutable tag, not digest

**Where:** `infra/typesense.tf:18` — `typesense/typesense:0.27.0` (no SHA
digest).
**What's needed:** Pin to `typesense/typesense@sha256:<digest>` and configure
Dependabot to bump the digest. Requires `terraform plan` to verify no drift
before applying.

---

## L14 — `_held/` quarantine GCS prefix has no terminal Delete lifecycle rule

**Where:** `infra/buckets.tf:101-110` — only a SetStorageClass-to-COLDLINE rule
at age 365 days; no Delete rule.
**What's needed:** Add a Delete lifecycle rule at age 2 557 days (≈7 years) and
document the retention policy in `docs/runbooks/media-moderation.md`.
Requires legal/counsel sign-off per existing comment; file a ticket before
implementing.
