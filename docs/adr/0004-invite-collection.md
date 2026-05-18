# ADR 0004 — Replace single `inviteCode` field with invite subcollection

**Date:** 2026-05-02  
**Status:** Accepted

## Context

The original group model stored a single `groups/{gid}.inviteCode` string. This worked for Phase 1 but had several problems:

1. No expiry — links lived forever with no way to invalidate them.
2. No usage tracking — leaders couldn't see who joined via which link.
3. Single invite per group — a leader couldn't have a "7-day" invite and a "single-use" invite simultaneously.
4. No revocation — a compromised code could only be fixed by rotating the group-level field, breaking every previously shared URL in the process.
5. A collection-group query on `inviteCode` across all groups (to look up a code on join) scans the entire `groups` collection — an O(groups) read.

## Decision

Replace the single field with a `groups/{gid}/invites/{inviteId}` subcollection. Each document holds:

- `code` — 8-char base32 code, unique within the group (not globally)
- `expiresAt` — Timestamp or null (never)
- `maxUses` — int or null (unlimited)
- `useCount` — server-maintained via Firestore transaction
- `lastUsedAt`, `lastUsedByUid` — for audit/display
- `revokedAt`, `revokedBy` — soft revoke

Code lookup uses `db.collection_group("invites").where("code", "==", code).where("revokedAt", "==", null)`. This is backed by the composite COLLECTION_GROUP index on `(code ASC, revokedAt ASC)`. The Admin SDK (server-side, bypasses security rules) performs the lookup, so it does not expose invite codes across group boundaries to clients.

Consumption is transactional: the `useCount` increment and `members/{uid}` write happen atomically, preventing concurrent `maxUses=1` joins from both succeeding.

## Consequences

- The `inviteCode` field on the group doc was not fully migrated to null-and-remove: as of Phase 3, `backend/app/routers/groups.py` still generates, rotates, and queries the `inviteCode` field as the primary simple-join mechanism. The invite subcollection (T25) ships as an additional advanced-invite feature alongside it. The full migration to subcollection-only join was deferred.
- The migration script `backend/scripts/migrate_invite_codes.py` is idempotent and must be run once against production before deploying T25.
- Collection-group reads inside a Firestore transaction are an unusual pattern. The Admin SDK supports this; the client SDK does not. This is intentional — the security rule sets `write: if false` so clients can never consume or modify invites directly.
- A single group can now have multiple active invites simultaneously (useful for single-use onboarding links alongside a permanent team link).
