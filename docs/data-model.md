# JACOB Firestore data model

This document describes every Firestore collection, who reads/writes it, and
shows an example of each document. Field semantics live here; access control
is enforced in [firestore/firestore.rules](../firestore/firestore.rules) and
verified in [firestore/tests/rules.test.ts](../firestore/tests/rules.test.ts).

Conventions:

- All timestamps are `serverTimestamp()`. Clients never write client time.
- `schemaVersion: 1` is set on user and group documents to support future
  migrations.
- Counters (`memberCount`, `threadReplyCount`) are maintained by Cloud
  Functions running with the Admin SDK; the client never updates them.

## Collection map

```
users/{uid}
users/{uid}/private/{docId}
groups/{gid}
groups/{gid}/members/{uid}
groups/{gid}/messages/{mid}
stickers/{stickerId}
moderation_queue/{itemId}      # backend only
bans/{uid}                     # backend only
audit_log/{eventId}            # backend only
```

---

## `users/{uid}`

Public-safe identity for an authenticated user. Readable only by the user
themselves; written only by the user themselves; deleted only via the
backend (T14).

```json
{
  "displayName": "Alice Anderson",
  "photoURL": "https://.../alice.jpg",
  "role": "member",
  "isMinor": false,
  "deletionRequestedAt": null,
  "schemaVersion": 1,
  "createdAt": "<serverTimestamp>"
}
```

- `role` is informational. Admin authorization is gated on the
  `admin` Firebase Auth custom claim, not this field.
- `role` and `createdAt` are immutable once set.

### `users/{uid}/private/{docId}`

PII and leader/mod-only fields the user should not expose. Owner-only
read/write.

Example `users/{uid}/private/profile`:

```json
{
  "email": "alice@example.com",
  "phone": null,
  "addressLine1": null,
  "lastSignInIp": "203.0.113.42"
}
```

---

## `groups/{gid}`

A small group. Members can read; only the leader can update metadata.
Created by any authenticated user, who must immediately self-add to
`members/{uid}` as `leader` to retain access (the bootstrap path in the
rules).

```json
{
  "name": "Pleasant Grove Tuesday Night",
  "description": "Tuesday night small group, Pleasant Grove campus.",
  "createdBy": "uid_alice",
  "createdAt": "<serverTimestamp>",
  "isPrivate": true,
  "inviteCode": "PG-TUE-7Q3X",
  "memberCount": 8,
  "stickerSet": "christian",
  "schemaVersion": 1
}
```

Leaders may update `name`, `description`, `isPrivate`, `inviteCode`,
`stickerSet`. `memberCount` is updated by a Cloud Function in response
to writes under `members/`.

### `groups/{gid}/members/{uid}`

Membership record. Two creation paths:

1. **Bootstrap.** The user identified by `groups/{gid}.createdBy` may
   self-add as `leader` once. Sequential client writes: create the group
   doc first, then this membership.
2. **Leader-add.** An existing leader may add any user as `member` or
   `leader`.

A user may delete their own membership (leave). A leader may delete any
membership in their group.

```json
{
  "role": "leader",
  "joinedAt": "<serverTimestamp>"
}
```

### `groups/{gid}/messages/{mid}`

A chat message. Group members can read and create. Only the author can
edit (`body`, `editedAt`) or soft-delete (`deletedAt`). Hard deletion is
forbidden — soft-delete only.

`threadReplyCount` is maintained by a Cloud Function watching writes to
this collection; clients cannot update it.

Top-level message:

```json
{
  "authorUid": "uid_bob",
  "body": "Tonight's reading is John 15.",
  "stickerIds": [],
  "mediaRefs": [],
  "parentMessageId": null,
  "threadReplyCount": 2,
  "createdAt": "<serverTimestamp>",
  "editedAt": null,
  "deletedAt": null
}
```

Threaded reply (rules verify the parent message exists in the same
group at write time):

```json
{
  "authorUid": "uid_carol",
  "body": "Thanks — see you tonight.",
  "stickerIds": ["sticker_amen"],
  "mediaRefs": [],
  "parentMessageId": "msg_abc123",
  "threadReplyCount": 0,
  "createdAt": "<serverTimestamp>",
  "editedAt": null,
  "deletedAt": null
}
```

---

## `stickers/{stickerId}`

Reaction stickers. Read-only for any authenticated user; seeded and
maintained via the Admin SDK (see seed scripts under
[firestore/seed/](../firestore/seed/)).

```json
{
  "name": "Amen",
  "slug": "amen",
  "audience": "christian",
  "order": 10,
  "retiredAt": null
}
```

---

## `moderation_queue/{itemId}` (backend only)

Items pending human moderator review. Written by the moderation pipeline
(T11) and read/updated by the admin dashboard (T13). No client access.

```json
{
  "resourceRef": "groups/g_abc/messages/m_xyz",
  "reason": "vision_safesearch_adult",
  "status": "pending",
  "createdAt": "<serverTimestamp>",
  "reviewedBy": null
}
```

---

## `bans/{uid}` (backend only)

Active bans. The presence of `bans/{request.auth.uid}` with
`expiresAt > now` causes every write rule in the system to deny via
`notBanned()`.

```json
{
  "reason": "Repeated violation of community guidelines",
  "bannedBy": "uid_admin",
  "expiresAt": "2026-06-01T00:00:00Z"
}
```

---

## `audit_log/{eventId}` (backend only)

Append-only record of admin/moderator actions. No client access; written
exclusively by the backend.

```json
{
  "actorUid": "uid_admin",
  "action": "ban_user",
  "targetRef": "users/uid_eve",
  "createdAt": "<serverTimestamp>",
  "payload": {
    "reason": "Repeated violation",
    "expiresAt": "2026-06-01T00:00:00Z"
  }
}
```

---

## Composite indexes

Defined in [firestore/firestore.indexes.json](../firestore/firestore.indexes.json):

| Collection         | Fields                                                | Used by                                   |
|--------------------|-------------------------------------------------------|-------------------------------------------|
| `messages`         | `parentMessageId ASC`, `createdAt DESC`               | top-level feed (parentMessageId == null) and thread reads (parentMessageId == <id>) |
| `moderation_queue` | `status ASC`, `createdAt ASC`                         | admin dashboard pending-queue listing     |
