# ADR 0003 — Memberships derived from a collection-group query

**Status:** Accepted  
**Date:** 2026-05-02  
**Resolves:** Phase 1 deferred item M11

---

## Context

Phase 1 mirrored a user's memberships onto `users/{uid}.groupIds` via
`ArrayUnion` — the backend wrote it on group create / join, and the
frontend read it from the user doc. The May 2026 codebase review (M11)
flagged two problems:

1. The mirror is schema drift: `groupIds` isn't in `CLAUDE.md` /
   `docs/data-model.md`, and the rule allowed it in older revisions.
2. The mirror invites split-brain: a member doc can exist without the
   matching `groupIds` entry (or vice versa) if the batched write
   half-succeeds.

CLAUDE.md's "no collection-group queries without an ADR" line is the
reason this lives here.

## Decision

Memberships are read from a single collection-group query against the
`groups/{gid}/members` subcollection, filtered by a new `uid` field
that equals the document ID:

```ts
collectionGroup(firestore, "members").where("uid", "==", currentUid)
```

The `groups/{gid}/members/{uid}` doc gains a `uid` field. A new field
override registers it in both `COLLECTION` and `COLLECTION_GROUP`
scopes (`firestore.indexes.json`).

The Firestore rule keeps `allow read: if isGroupMember(gid) || isUser(uid)`.
Per-doc evaluation is fine: the matched docs all live at path
`groups/{gid}/members/{auth.uid}`, so `isUser(uid)` matches and the
read is permitted. To prevent a malicious server from forging member
docs whose `uid` field disagrees with the doc ID, the create rule now
asserts `request.resource.data.uid == uid` whenever `uid` is present.

The backend writes the `uid` field on every new member doc.
`backend/scripts/backfill_member_uid.py` populates the field on
pre-existing docs (idempotent: re-running is safe).

## Why not …

- **… keep `users/{uid}.groupIds` and lock it in the rule.** Simpler,
  but does nothing about split-brain or the additional write per join.
  Doesn't address the schema-drift critique cleanly — `groupIds` would
  remain a denormalisation we have to keep in sync.

- **… single-collection of memberships at the top level (e.g.
  `memberships/{uid}_{gid}`).** A new top-level collection is a bigger
  rule shape and breaks the "membership lives under the group" model
  used elsewhere in the rules.

- **… query by `documentId()` in the CG query.** Firestore CG queries
  treat `documentId()` as the full document path, not the leaf, so we
  can't say "any member doc whose ID equals X" in one query.

## Cross-group permission boundary

A collection-group query crosses the natural per-group permission
boundary. The rule mitigates this by tightly coupling the read
predicate to the doc-ID variable: `isUser(uid)` only passes when the
authenticated user is the same as the doc-ID, which by invariant is
the same as the `uid` field. There is no way for a user to enumerate
memberships of another user via this path.

## Consequences

- **+** One realtime listener replaces one read-per-group on mount.
- **+** No more split-brain — the source of truth is now the membership
  doc itself.
- **+** Removes the `groupIds` write from `groups.create_group` /
  `groups.join_group`.
- **−** A new index in `firestore.indexes.json` (`members.uid` in
  `COLLECTION_GROUP` scope).
- **−** A backfill script must be run once per environment.
- **−** Future tasks that want to add other CG queries should review
  this ADR for the rule pattern.

## Migration

1. Deploy the rule + index update.
2. Deploy the backend change so new memberships include `uid`.
3. Run `python backend/scripts/backfill_member_uid.py` against staging,
   then production.
4. Deploy the frontend update.
5. After 30 days with no errors, delete the legacy `groupIds` field
   from existing user docs (separate cleanup script — out of scope for
   the M11 PR).
