# ADR 0005 — Full-text message search via Typesense sidecar

**Status:** Superseded by [ADR 0016](0016-native-firestore-search.md) (2026-05-23). The Typesense sidecar never reliably booted, sat as a dormant $100/month always-on cost risk, and search isn't a near-term priority — we replaced it with native Firestore keyword search.
**Date:** 2026-05-02
**Resolves:** Phase 2 task T28
**Spec section:** `docs/phase-2-impl-spec.md` § "T28 — Full-text search sidecar (Typesense)"

---

## Context

Members need to search messages across every group they belong to.
Firestore's text matching is prefix-only on a single field, scales poorly
to multi-group cross-cuts, and bypasses our per-group rule boundary the
moment we widen the index. Phase 1 deliberately deferred search; Phase 2
T28 makes it a first-class feature with sub-second latency.

Three judgment calls had to be settled before writing any code:

1. Which search engine.
2. How to enforce the per-group permission boundary that Firestore
   rules give us today, given the search engine sits *outside* those
   rules.
3. What goes in the index — body only, or stickers / mentions / media
   metadata too.

CLAUDE.md's "no collection-group queries without an ADR" line, plus the
"never write to Firestore from the client without a corresponding
security rule" line, drove the structure of this decision.

## Decision

### 1. Vendor — self-hosted Typesense on Cloud Run, NOT Typesense Cloud

The implementation spec's pre-decision was Typesense Cloud (~$70/month,
single-node M cluster). We override that choice for the following
reasons:

- **Money constraint.** The current operating model for JACOB is "no
  paid external services unless they directly unblock the product."
  $70/month/environment × dev + staging + prod = $210/month for a
  feature whose v2 traffic we project at <100 queries/day.
- **Stateful workload, but small.** The Typesense index for the entire
  v2 message corpus fits comfortably in 1–2 GB. A single-instance
  Cloud Run service with a persistent disk via a Cloud Storage volume
  mount, fronted by an internal load balancer, is operationally viable
  for v2 scale and costs ~$15/month with min-instances=0 + a small
  disk.
- **Same trust model.** Either path puts Typesense behind the backend
  (no client access). The vendor decision does not change the
  authorization story.
- **Reversible.** The wire protocol is identical (REST, same SDK, same
  schema). We can lift-and-shift to Typesense Cloud in a single
  PR if scale or operational pain demands it. The ADR does not become
  load-bearing once we cut over.

**Alternative considered — Algolia.** Sub-second latency, generous
free tier (10k records / 10k searches per month). Rejected because
(a) the free tier cap is too tight against v2 message volume
projections (we already have >10k messages in dev fixtures); and
(b) Algolia's JS SDK is client-first, which encourages developers to
sneak around the backend authorization layer — exactly the failure
mode the spec calls out.

**Alternative considered — Meilisearch.** Comparable to Typesense.
Lost to Typesense on the basis that Typesense's `filter_by` syntax
maps directly to the per-group permission boundary we need to enforce
(see §2 below) and the spec already pre-decided in its favor; we did
not see a meaningful operational reason to override.

### 2. Authorization model — backend-mediated, per-request membership enumeration

The client cannot query Typesense directly. The backend exposes
`GET /api/search?q=...&page=...&perPage=...` which:

1. Calls `db.collection_group("members").where("uid", "==", user.uid).limit(100).stream()`
   to enumerate the caller's group memberships from the Firestore
   collection-group `members` index introduced in ADR 0003. The 100
   cap is a safety valve; v2 users are not expected to be in >100
   groups, and the limit is documented in the runbook so an operator
   can raise it after auditing the schema.
2. Builds a Typesense query that pins the result set to those gids:
   `filter_by: groupId:[g1,g2,…] && moderationState:!=hidden`.
3. Forwards the response, normalised into `SearchResponse`.

This means a stale Typesense index never leaks across the per-group
boundary: the filter is recomputed *per request* from the live
membership doc, so the moment a user leaves a group their next search
no longer returns its messages — even if the index still holds them.

ADR 0003 already established that
`allow read: if isGroupMember(gid) || isUser(uid)` is the rule for
`groups/{gid}/members/{uid}` and that the collection-group read is
safe because per-doc evaluation pins the doc-ID to the calling user.
This ADR reuses that property — the search backend reads memberships
under the calling user's privilege, not via Admin SDK rule-bypass — so
the same auditability holds.

The Admin SDK *is* used inside the Cloud Function trigger (write side)
to upsert messages into Typesense regardless of group privacy. That is
intentional: the trigger must always reflect Firestore.

### 3. Index schema

```
{
  "name": "messages",
  "fields": [
    { "name": "id",                "type": "string"                 },
    { "name": "groupId",           "type": "string",  "facet": true },
    { "name": "authorUid",         "type": "string",  "facet": true },
    { "name": "authorDisplayName", "type": "string",  "optional": true },
    { "name": "body",              "type": "string"                 },
    { "name": "stickerIds",        "type": "string[]","facet": true,  "optional": true },
    { "name": "createdAtUnix",     "type": "int64"                  },
    { "name": "parentMessageId",   "type": "string",  "facet": true,  "optional": true },
    { "name": "moderationState",   "type": "string",  "facet": true,  "optional": true }
  ],
  "default_sorting_field": "createdAtUnix"
}
```

- `body` is the primary `query_by` field; `authorDisplayName` is a
  secondary `query_by` so a user can find "messages by Alice".
- `groupId`, `authorUid`, `parentMessageId`, `moderationState` are
  filterable.
- `createdAtUnix` is the default sort (newest first).
- No image OCR. No reaction counts. Messages with media but no body
  text are still indexed (empty `body`) so the metadata surfaces.
- **`moderationState`** is denormalised into the index so the search
  filter excludes hidden-by-T20 messages without an extra Firestore
  round-trip per hit. The trigger re-upserts on `moderation.state`
  changes (see "Update guard" below).
- **Schema versioning.** The collection name is `messages_v1`. A
  `messages` alias points at the active version. Schema migrations
  build the new collection (`messages_v2`), reindex into it, and
  atomically flip the alias. The reindex script lives at
  `infra/scripts/reindex_messages.py`.

### Update guard — `shouldReindex`

`onMessageIndex.ts` fires on every write to `groups/{gid}/messages/{mid}`.
A pure helper `shouldReindex(before, after)` returns `true` only when
one of `body`, `mediaRefs`, `editedAt`, `deletedAt`, `moderation.state`,
`stickerIds` changed (or on create / hard-delete). This avoids
upserting Typesense on every reaction-count or thread-reply-count
denormalisation tick — both of which churn frequently.

### Cloud Functions trigger pattern

`onMessageIndex.ts` follows pattern P3 (region us-central1,
`maxInstances: 10`, `retry: false`, idempotency keyed by
`event.id`) and pattern P8 (process-local circuit breaker around the
external API). Idempotency is keyed under
`groups/{gid}/messages/{mid}/_index_events/{eventId}`. Quota is keyed
under `search_state/index-{YYYY-MM-DD}` with cap
`JACOB_SEARCH_INDEX_DAILY_CAP` (default 50 000 — generous for v2,
adjustable via env).

### API-key model

Two keys, both stored in Secret Manager:

- **Admin key** (`TYPESENSE_ADMIN_KEY`): write access, mounted into the
  Cloud Function only.
- **Search key** (`TYPESENSE_API_KEY`): read-only, scoped to the
  `messages` collection, mounted into the backend Cloud Run service
  only.

Rotation procedure is in `docs/runbooks/search.md`.

### Feature flag + kill-switch

- **`JACOB_SEARCH_ENABLED`** (backend env, default `false`): when
  `false`, the backend endpoint returns
  `503 { "code": "search_disabled" }`. Lets us deploy the function
  (which keeps the index warm) and ramp the user-facing endpoint
  separately.
- **`TYPESENSE_DISABLED`** (function env, default `false`): when
  `true`, the trigger no-ops with a `search_index_disabled` log line.
  Use this if Typesense is down or running away on cost.

## Why not …

- **… index Firestore-side via composite indexes only.** Single-field
  prefix matches across messages collection-group queries are not
  expressive enough for substring or stem-matched search, and a
  collection-group query against `messages` would be a major rule
  change — see CLAUDE.md "no collection-group queries without an
  ADR". The spec is explicit that this would be its own ADR.
- **… BigQuery as the search backend.** Query latency (~5s for
  simple LIKE scans) would not meet the sub-second acceptance bar,
  and we'd be paying per-byte-scanned for queries, which is the
  worst pricing model for read-heavy search.
- **… Algolia / Typesense Cloud.** See §1 above — money + free-tier
  cap arguments.

## Cross-group permission boundary

The risk of search is "Alice queries for `q` and gets back a message
from a group Alice is not in." The mitigations are layered:

1. The frontend never holds a Typesense client. ESLint
   `no-restricted-imports` blocks any direct import in `frontend/`.
2. The backend constructs the `filter_by` from the *live* membership
   collection-group query, not from a cached value, so leaving a group
   takes effect immediately.
3. The trigger removes a message from the index as soon as
   `deletedAt` is set; soft-deletes therefore vanish from search
   within one event tick.
4. The membership read in the backend uses the caller's privilege
   (Admin SDK reads are intentionally avoided here — though the SDK
   *could* read members, doing it under the user's auth means the same
   collection-group rule we wrote in ADR 0003 protects against
   forgery).

Groups are *never* deleted in v2 (archived only — see T23). If group
deletion is added later, the trigger MUST also walk the group's
messages and delete them from the index, or the index will accumulate
ghosts.

## Consequences

- **+** Sub-second message search across all of a user's groups.
- **+** Adds no new Firestore data path or rule shape. Schema-versioned
  Typesense collection lets us migrate forward without downtime.
- **+** Hidden-by-moderation messages are filtered at the index, not
  re-fetched from Firestore — cheaper and fewer round-trips.
- **−** New external service to operate. Runbook
  (`docs/runbooks/search.md`) covers outage, reindex, schema
  migration, and key rotation.
- **−** `authorDisplayName` is denormalised into the index; a renamed
  user's old messages keep the old name in search results until the
  next time they're re-indexed (acceptable per spec — the result links
  open the live message, which renders the live name).
- **−** Two new Secret Manager entries to rotate.
- **−** Cost: ~$15/month for the self-hosted Cloud Run instance + disk
  per environment. Re-evaluate when v2 active users >5 000 or sustained
  query rate >5 QPS.

## Migration

1. Provision Typesense via `infra/typesense.tf` (Cloud Run service +
   persistent volume + Secret Manager entries).
2. Deploy the Cloud Function (it begins keeping the index in sync).
3. Run `python infra/scripts/reindex_messages.py` once per environment
   to backfill historical messages.
4. Deploy the backend with `JACOB_SEARCH_ENABLED=false` so the
   endpoint returns the disabled error while the index warms.
5. Verify reindex counts within 1% of Firestore counts (acceptance
   criterion).
6. Flip `JACOB_SEARCH_ENABLED=true`. Monitor query latency + error
   rate. Roll back via env flip if anything regresses.
