# ADR 0016 — Native Firestore message search

**Status:** Accepted
**Date:** 2026-05-23
**Supersedes:** [ADR 0005](0005-search-sidecar.md) (Typesense sidecar)

---

## Context

ADR 0005 picked a self-hosted Typesense Cloud Run service as the
full-text engine for `/api/search`. In practice the sidecar never
booted cleanly — yet it remained provisioned with `min_instance_count
= 1`, `cpu-throttling=off`, 2 vCPU / 2 GiB. That's a dormant ~$100/mo
spend on a service that produced zero search responses.

Search is not on the near-term roadmap. The Phase 3 product focus is
elsewhere, and member feedback hasn't surfaced search as a priority.
Continuing to pay (in money and operational complexity) for an engine
nobody is using doesn't make sense.

## Decision

Remove Typesense entirely. Replace the search backend with Firestore
queries against a denormalised `searchTokens` array on each message.

### What the implementation looks like

- A Cloud Function trigger (`onMessageTokenize`, replacing the deleted
  `onMessageIndex`) watches every `groups/{gid}/messages/{mid}` write
  and maintains `searchTokens: string[]` — the lowercased,
  word-tokenised, de-duplicated form of the message body, capped at
  100 tokens per doc. The trigger is self-stable: when its own write
  re-fires the trigger, `tokensEqual` returns true and the second
  delivery is a no-op.
- The backend `/api/search` endpoint:
  1. Looks up the caller's group memberships via the same
     collection-group `members` query the rest of the codebase uses
     (ADR 0003), capped at 30 groups.
  2. For each membership, runs a `messages.where("searchTokens",
     "array_contains", <primary token>).limit(100)` query.
  3. Merges results, drops `deletedAt != null` and `moderation.state
     == "hidden"` docs in code, and for multi-word queries post-filters
     to docs that contain *every* query token.
  4. Sorts by `createdAt` desc and slices to the requested page.
- One Firestore field override added for `messages.searchTokens` with
  `arrayConfig: CONTAINS` at collection scope. No composite index is
  needed because sorting happens server-side in the API layer rather
  than via `order_by`.

### What this gives up vs. Typesense

- **No typo tolerance** — "fellwoship" finds nothing; "fellowship" does.
- **No stemming / morphology** — "praying" and "prayed" are distinct
  tokens.
- **No relevance ranking** — results are strictly newest-first. Two
  matches in the same message do not float it up.
- **No highlighting** — the frontend renders the raw message body for
  each hit, not a `<mark>`-wrapped snippet. The matched word is still
  obvious because the body is short, but the response no longer
  carries any HTML.
- **`total` is approximate** — it reflects the merged hit set across
  per-group queries (each capped at 100), not a true Firestore count.
  Acceptable while search is a low-priority feature; the pager still
  works because `total` is monotonically consistent within a session.
- **Membership cap of 30** for the per-request fan-out (down from
  Typesense's 100). Users in more groups will see results only from
  their first 30; in practice nobody is in more than ~10.

These are deliberate. If search becomes a priority again we can
revisit (a hosted Algolia/Meilisearch trial, or moving back to
Typesense done right).

### What this saves

- ~$100/mo recurring spend killed.
- One Cloud Run service, one Cloud Function, two Secret Manager
  secrets, one dedicated service account, and one Terraform module
  removed from the codebase.
- One fewer operational dependency to monitor.

## Security & authorization

Unchanged from ADR 0005's threat model: the per-group `.where(...)`
query is rooted at `groups/{gid}/messages`, so even a misbehaving query
cannot return docs the caller isn't a member of. The membership
enumeration uses the same Admin SDK collection-group read the old code
used. Hidden and soft-deleted messages are filtered in-process before
the response is built.

## Migration

- The `searchTokens` field is populated lazily as messages are written
  or edited. Backfill of existing messages is out of scope — search
  will return results for new messages immediately and for older
  messages only after they're touched. A one-shot backfill can be
  added later if needed (re-implementing what `infra/scripts/reindex_messages.py`
  used to do, but writing to Firestore instead of Typesense).
- The frontend response shape is unchanged (`SearchResponse` with
  `hits`, `total`, `page`, `limit`) so `useSearch` and `SearchBar`
  need no logic changes — only the snippet sanitiser was simplified
  because `<mark>` no longer appears.
- The live `typesense-staging` Cloud Run service, both Typesense
  Secret Manager entries, and the `jacob-typesense` service account
  were deleted as part of the rollout.
