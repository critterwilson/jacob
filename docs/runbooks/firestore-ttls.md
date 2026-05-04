# Runbook — Firestore TTL on idempotency-marker collections (M16)

Cloud Function v2 Firestore triggers are at-least-once. Each trigger writes a
small marker doc under its parent so a duplicate delivery short-circuits
without re-running the side effects. Once the dedupe window has passed, the
marker has no value — but Firestore won't delete it without help.

This runbook is the operational counterpart to
`docs/follow-ups/phase-2-deferred.md` (M16): how to enable TTL, how to verify
it, how to disable it if needed.

## What's configured

| Collection group   | Trigger                                  | TTL field   |
|--------------------|------------------------------------------|-------------|
| `_events`          | `onMessageWrite`                         | `expiresAt` |
| `_reaction_events` | `onReactionWrite`, `onBoardReactionWrite`| `expiresAt` |
| `_index_events`    | `onMessageIndex`                         | `expiresAt` |
| `_post_events`     | `onBoardPostWrite`                       | `expiresAt` |
| `_reply_events`    | `onBoardReplyWrite`                      | `expiresAt` |
| `_member_events`   | `onMemberWrite`                          | `expiresAt` |

`expiresAt` is set by `functions/src/services/eventMarkers.ts` to
`Timestamp.now() + 7 days` at marker creation. 7 days is comfortably longer
than any plausible re-delivery window for v2 Firestore triggers (retries are
bounded by minutes-to-hours, never days).

## Apply (one-time, per environment)

The TTL config is **per-collection-group**, lives outside the
`firebase.json` deploy flow, and must be applied with `gcloud`:

```bash
./infra/firestore-ttls.sh <project-id>
# e.g.
./infra/firestore-ttls.sh jacob-staging-494515
./infra/firestore-ttls.sh jacob-prod        # when prod exists
```

The script is idempotent — re-running on already-enabled collections is a
no-op.

**Order of operations:** apply TTL **after** the function code that writes
`expiresAt` has shipped. If TTL is enabled before docs have an `expiresAt`
field, Firestore simply ignores them (docs without the field are never
considered for deletion), so this isn't dangerous — just pointless until the
new function code is live.

## Verify

```bash
gcloud firestore fields list \
  --project=<project-id> \
  --filter='ttlConfig:*'
```

Expect six rows, one per collection group above, each with
`ttlConfig.state: ACTIVE`.

In the Firestore console: **Indexes → Single field → filter on TTL** shows
the same set.

## Costs

- TTL itself is free.
- Storage cost **decreases** as old markers are reclaimed.
- No additional read/write quota — TTL deletions don't count against your
  daily quota (per Google's TTL pricing docs).

## Disable / rollback

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=_events \
  --disable \
  --project=<project-id>
```

(Repeat for each collection group, or edit `infra/firestore-ttls.sh` to flip
`--enable` to `--disable` and re-run.)

Disabling TTL stops new deletions; docs already deleted are gone.

## Why a script and not `firestore.indexes.json`?

The Firebase CLI does support TTL via field overrides, but this repo had no
existing precedent for that pattern. To avoid being the first to use it
without an ADR — and because the gcloud command is reproducible and runs in
seconds — the script is the deliverable. If a future change adds another TTL
field, consider promoting both to `firestore.indexes.json` field overrides
together.
