# Realtime Database (RTDB) runbook (T48)

## What this is

T48 introduces Firebase Realtime Database as a separate data plane
from Firestore. RTDB carries **only ephemeral signals** — presence,
typing, and (T50) Watch Together sync state. Persistent product
data stays in Firestore.

The split is deliberate:

* RTDB has cheap per-field updates and built-in `onDisconnect()`
  cleanup, which is exactly what presence wants.
* Firestore is queryable, indexed, and integrates with our backend.
* Mixing the two is OK because the access shapes are different —
  RTDB writes are tiny and frequent; Firestore writes are durable
  and audited.

## Authorization model

Per the M6 architecture, Firestore writes flow through FastAPI.
RTDB writes go **directly from the client** to RTDB — that's the
whole point — but they're authorized by:

1. Firebase Auth (the user must be signed in).
2. The membership mirror at `/memberships/{uid}/{gid}: true` that
   `onMemberWrite` (functions/src/onMemberWrite.ts) maintains in
   sync with the Firestore member doc.
3. RTDB rules (`infra/firebase-rtdb-rules.json`) that gate every
   `/presence/{gid}` and `/typing/{gid}` write on the membership
   mirror's existence.

If a user is removed from the Firestore group, the trigger removes
their membership mirror, and they immediately lose RTDB write
access.

## Paths

```
/memberships/{uid}/{gid}      true                          // mirror; admin SDK only
/presence/{gid}/{uid}         { lastSeenAt, status }        // members only
/typing/{gid}/{uid}           { startedAt }                 // members only; auto-deleted
```

(T50 adds `/watch_sessions/{sessionId}/state` — separate runbook.)

## Cost & free-tier scale

Firebase RTDB free tier: 100 simultaneous connections, 1 GB stored,
10 GB egress per month. At v1 scale (small groups, ~handful of
sessions per group), this comfortably covers usage. The
`/memberships` mirror grows as O(users × groups-per-user); even at
1k users × 5 groups average, that's ~5k tiny boolean docs.

If we hit the connection ceiling, the upgrade path is the Blaze
plan with pay-as-you-go pricing. T59's incident playbook lists
"RTDB connection saturation" as a SEV2 to watch.

## Deploying RTDB rules

One-time:

```bash
firebase deploy --only database --project <project-id>
```

The rules live at `infra/firebase-rtdb-rules.json` and the path is
declared in `firebase.json`. CI doesn't deploy them automatically —
operator step.

## Local emulator

```bash
firebase emulators:start --only firestore,database,auth
```

The frontend picks up the emulator when
`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`. The hooks in
`frontend/lib/hooks/usePresence.ts` and `useTyping.ts` connect to
`127.0.0.1:9000` automatically.

## Troubleshooting

* **Presence count stuck at zero.** Check that `onMemberWrite`
  fired for the affected user. The membership mirror is the
  authorization gate; without it RTDB rules deny every write.
* **`onDisconnect` not firing.** Browsers don't always close the
  socket cleanly on tab-close; the 60s heartbeat compensates by
  letting client-side filters age out stale `lastSeenAt`.
* **Typing flicker.** The hook batches writes so the same key-down
  every 50ms doesn't spam RTDB; you'll see at most one write every
  2s.
* **`presenceEnabled === false`.** The leader has turned the
  social signal off for this group. Both presence and typing
  return empty arrays from the hooks.

## Monitoring

Firebase console → Realtime Database → Usage tab shows live
connections and storage. Set a Cloud Monitoring alert at 80% of
the 100-connection ceiling so we have time to upgrade before
hitting it.

## Related

* T48 — presence + typing (this surface)
* T50 — Watch Together (uses RTDB for sync state)
* T57 — voice rooms (parked; would also use RTDB)
