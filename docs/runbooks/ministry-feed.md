# Central ministry feed runbook (ADR 0011)

## What this is

A top-level broadcast surface at `/feed` for the ministry owner to
share sermons, devotionals, and announcements with **every** member
of the platform. Per-group sermon posting (T52) and per-group
announcements (T24) are unaffected — this is additive.

* Posts: `ministry_feed/{postId}` (Firestore, top-level).
* Endpoints: `/api/ministry-feed/*`.
* Writer role: Firebase custom claim `ministry_owner: true`.
* Reactions: yes (reuses the standard sticker primitive).
* Comments: no (v1; revisit when there's demand + a moderation plan).
* Pinning: yes (multiple pins allowed; UI surfaces them above
  unpinned posts).
* Notifications: opt-IN via `notificationPrefs.ministryFeed`
  (default off).

See [`docs/adr/0011-ministry-feed.md`](../adr/0011-ministry-feed.md)
for the rationale behind each of these choices.

## Granting the ministry-owner role

Two equivalent paths:

### From the CLI (bootstrap path)

```bash
cd backend
uv run python scripts/grant_ministry_owner.py <uid>
```

The script preserves any other custom claims on the user (e.g.
`admin`). The grantee must sign out and back in (or wait for a
token refresh) before the claim is visible client-side.

### From the admin API

```bash
# Grant
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://API/api/admin/users/$UID/ministry-owner

# Revoke
curl -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://API/api/admin/users/$UID/ministry-owner
```

Both calls write an `audit_log` row (`action: grant_ministry_owner`
/ `revoke_ministry_owner`).

## What the owner sees

When a `ministry_owner` user visits `/feed`, the page renders the
read view *plus* a compose form (title + markdown body + optional
sermon link). Anyone else sees only the read view. The frontend
gates the compose UI on the `ministry_owner` claim resolved from
`getIdTokenResult()`; the backend enforces the same check via
`require_ministry_owner`. The frontend hide is convenience —
posting attempts without the claim return 403.

## Post lifecycle

| Action       | Endpoint                                                       | Role            |
| ------------ | -------------------------------------------------------------- | --------------- |
| List         | `GET    /api/ministry-feed/posts`                              | any signed-in   |
| Read         | `GET    /api/ministry-feed/posts/{post_id}`                    | any signed-in   |
| Create       | `POST   /api/ministry-feed/posts`                              | ministry_owner  |
| Update       | `PATCH  /api/ministry-feed/posts/{post_id}`                    | ministry_owner  |
| Delete       | `DELETE /api/ministry-feed/posts/{post_id}` (soft)             | ministry_owner  |
| Pin          | `POST   /api/ministry-feed/posts/{post_id}/pin`                | ministry_owner  |
| Unpin        | `DELETE /api/ministry-feed/posts/{post_id}/pin`                | ministry_owner  |
| React        | `POST   /api/ministry-feed/posts/{post_id}/reactions/{slug}`   | any non-banned  |
| Unreact      | `DELETE /api/ministry-feed/posts/{post_id}/reactions/{slug}`   | any non-banned  |

Delete is soft — the doc keeps a `deletedAt` timestamp and is
filtered out of list/get responses. There is no hard-delete in v1
(an audit trail is more important than reclaiming the storage row).

## Notifications

On post create, the `onMinistryPostCreate` Cloud Function runs a
collection-group query over `notificationPrefs` where
`ministryFeed == true`, and writes one `users/{uid}/notifications/{nid}`
per opted-in user (excluding the author and users who have blocked
them). The standard `onNotificationCreate` trigger then dispatches
FCM the same way it does for every other kind.

Default for `notificationPrefs.ministryFeed` is **false** — users
must turn the toggle on in Settings → Notifications before they get
push for these posts. This is intentional (see ADR 0011 §5).

### Operational knobs

* If a broadcast accidentally fires (wrong content / wrong audience)
  and you want to suppress further pushes, flip the
  `MODERATION_TEXT_DISABLED`-style escape isn't applicable here —
  there is no kill switch yet. The fastest mitigation is to delete
  the post (the FCM notifications already in flight will still
  arrive, but the inbox row will resolve to a 404 when tapped).
  Tracking a `ministry_feed_dispatch_disabled` flag for emergencies
  is a follow-up.
* The CG index on `notificationPrefs.ministryFeed` is configured
  alongside the existing `digest` field index. If you add another
  cross-user broadcast surface, follow the same pattern.

## Storage shape

```
ministry_feed/{postId}:
  title: string
  body: string                  // markdown
  sermonUrl: string | null
  coverImageRef: string | null  // GCS public-bucket URL only
  authorUid: string
  createdAt: Timestamp
  editedAt: Timestamp | null
  deletedAt: Timestamp | null
  pinnedAt: Timestamp | null
  pinnedBy: string | null
  reactionCounts: { [stickerSlug]: number }

ministry_feed/{postId}/reactions/{stickerSlug}/users/{uid}:
  reactedAt: Timestamp
```

Rules: default-deny on every path; all reads and writes go through
`/api/ministry-feed/*`. See `firestore/firestore.rules` and the
companion tests in `firestore/tests/default-deny.rules.test.ts`.

## Out of scope (v1)

* Comments / replies on broadcast posts.
* Per-post audience selection (e.g. broadcast to a specific org
  only).
* Customizing notification copy per post.
* Custom sender domain / branded push (waiting on the wider domain
  pick).
