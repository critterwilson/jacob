# ADR 0013 — SSE realtime chat (M5)

**Status:** Accepted (2026-05-18)
**Authors:** M5 implementation pass
**Related:** `CLAUDE.md` § Polling and event hygiene, `docs/runbooks/realtime-messages.md`,
`frontend/lib/hooks/useGroupMessages.ts`, `backend/app/services/stream_hub.py`,
`backend/app/routers/messages.py`, `infra/cloud-run.tf`

## Context

M1–M6 moved every end-user read and write off the Firestore client SDK
and behind the FastAPI service. The load-bearing reason: adblockers
break direct `onSnapshot` and direct REST calls to `firestore.googleapis.com`
on a meaningful fraction of browsers. The realtime push that the original
`onSnapshot` provided was deferred — the chat surface has shipped on a
~10 s HTTP poll loop since then (`useGroupMessages` / `useThreadMessages`,
with `If-None-Match` short-circuits to 304).

Ten seconds is the wrong number for an active conversation. The ministry
owner has been asking for sub-second delivery since M6 landed; the
deferral note in `CLAUDE.md` reads "M5 reintroduces sub-second push when
revisited." This ADR locks in how.

The constraints carry forward from M1–M6:

1. No direct `onSnapshot` from the client. Adblockers will keep blocking
   it on a non-trivial slice of users; that's why the polling rewrite
   existed in the first place.
2. No paid third-party realtime services (Pusher, Ably, Supabase
   Realtime, LiveKit, anything in that bucket). Owner cost ceiling is
   ~$50/mo for the whole staging stack (ADR-adjacent: see the budget
   alerts wired in #253).
3. Cloud Run is already the FastAPI host and already mediates every
   read and write. Firebase Auth + Storage are still client-direct.
4. RTDB is in use for presence + typing indicators. Re-using it for the
   chat push surface would re-introduce the adblock failure mode for
   the highest-traffic surface in the app, so it's out.

## Decisions

This ADR locks in seven choices.

### 1. Transport: Server-Sent Events from the FastAPI backend

Each chat client opens `GET /api/groups/{gid}/messages/stream`. The
backend holds the HTTP connection open and writes `event: message`
frames over `text/event-stream` as new messages arrive. The connection
is plain HTTP from the browser to the same Cloud Run service every other
`/api/*` call already reaches.

Why SSE over the alternatives:

| Option         | Adblock-safe? | Cloud Run-native? | Server-push? | Cost              | Complexity     |
| -------------- | ------------- | ----------------- | ------------ | ----------------- | -------------- |
| **SSE**        | yes           | yes               | yes          | included          | low            |
| WebSockets     | yes           | yes (60 min cap)  | yes (duplex) | included          | medium         |
| Long-poll      | yes           | yes               | yes (~1 RTT) | included          | low            |
| RTDB push      | **no**        | n/a               | yes          | included          | low            |
| Pusher / Ably  | yes           | n/a               | yes          | $$$ over budget   | low (vendor)   |

SSE wins because:

* The chat surface only needs server → client push. WebSockets pay the
  duplex complexity tax (frame parsing, masking, ping/pong) without
  using the duplex direction; client-to-server writes still go through
  the existing `/api/groups/{gid}/messages` POST.
* Native `EventSource` is supported by every shipping browser. The one
  pothole — `EventSource` can't attach an `Authorization` header — is
  worked around inside `frontend/lib/sse.ts` by parsing the
  `text/event-stream` body off `fetch()` with a `ReadableStream` reader.
  That same approach also gets us per-call header support, a manual
  reconnect loop, and the ability to abort cleanly on unmount.
* Long-poll was the simpler stepping stone but adds RTT overhead the
  full-stream design doesn't, and inverts the keepalive story (server
  has to keep ending and re-handshaking the connection itself).
* RTDB push is out because it has the same adblock problem as
  `onSnapshot`.

### 2. Server-side change feed: per-instance Firestore listener, shared across connections to the same group

When the first connection to a given `gid` arrives on a Cloud Run
instance, the new `StreamHub` (`backend/app/services/stream_hub.py`)
attaches a Firestore listener via the Admin SDK to
`groups/{gid}/messages` filtered by `where("createdAt", ">=", now)`.
Subsequent connections to the same `gid` on the same instance share
that listener. The listener tears down when the last connection for
that group drops.

The Admin SDK listener runs server-side over Google's internal
network — no adblock surface, no public-internet egress for the change
notification, just a normal `gRPC` stream the Admin SDK manages.

Why share-per-(instance,group) instead of a listener per connection:

* Per-connection cost would scale with concurrent viewers. Sharing
  caps the listener count at `(active groups × Cloud Run instances)`.
  With one chatty group and three instances that's three listeners,
  not three-hundred connections.
* The listener already produces a fan-out via change events; the
  StreamHub re-fans onto each subscriber's `asyncio.Queue`. The cost
  difference between fanning to 1 queue vs. 80 queues is negligible.
* Each Cloud Run instance gets its own listener because Cloud Run runs
  one Python process per instance. The original Firestore document
  change is observed once per instance — that's the unavoidable read
  cost. See § Cost analysis below.

Why not a Pub/Sub topic fed by the existing `onMessageWrite` Cloud
Function? It works in theory but:

* Adds a moving part (Pub/Sub topic + subscription wiring) to a
  feature that is otherwise self-contained inside the backend.
* The push-style subscription model (one HTTP delivery per subscriber)
  needs every backend instance to subscribe individually; the pull
  model needs a long-running pull loop per instance. Either way is
  more code than the Admin SDK listener.
* Adds end-to-end latency: Firestore write → Cloud Function trigger
  (~hundreds of ms cold-start in the worst case) → Pub/Sub publish →
  pull → fan-out. The Admin SDK listener is the shortest path.
* Costs a Pub/Sub message per fan-out. The Admin SDK listener path
  costs only the Firestore listener reads we already pay.

Pub/Sub is the right escape hatch if the listener path can't scale
(documented in `docs/runbooks/realtime-messages.md` as the planned
migration if we ever blow past 1k concurrent listeners per instance).
We're not close.

### 3. Visibility filter: same shape as the polling read

`GET /api/groups/{gid}/messages/stream` reuses
`require_member_or_public_top_level` — identical to the polling
endpoint, identical to the visibility rules in
`firestore.rules:314-320`:

* Members see every non-hidden message in the group (hidden messages
  are redacted to the author only).
* Public-group non-members see top-level, non-deleted, non-hidden
  messages.
* Private-group non-members get 403.

The same `_filter_for_visibility` helper applies per-event before the
event is written to the SSE wire. Reusing the helper means there's no
divergence between what the poll loop returns and what the stream
emits.

### 4. v1 emits added + modified message changes; deletes and old-message edits still arrive on polling fallback / page refresh

The listener uses `where("createdAt", ">=", start_time)`. This means:

* **New messages** (top-level + thread replies) push instantly.
* **Edits** to messages whose `createdAt` is after `start_time` push
  via the listener's `MODIFIED` change.
* **Soft-deletes** of those same messages push as `MODIFIED` (the doc
  now carries `deletedAt`).
* **Edits or soft-deletes** of messages older than `start_time` do
  **not** push. The client picks them up on the next polling tick
  after SSE drops, or on a fresh page load.

This is a deliberate v1 limitation, not a bug:

* The dominant chat experience is "I sent a message, they saw it." That
  is now sub-second.
* The dominant edit experience — fixing a typo within seconds of
  sending — is also covered because the message is newer than
  `start_time`.
* The minority case — editing a message from yesterday and expecting
  another viewer to see the edit live — is still handled by the
  polling fallback after their session reconnects.

Removing the `>=` filter and tracking which doc IDs we've sent
per-connection is the next step if this limitation bites. It costs more
listener bandwidth (every change to every old message in the group
flows through the listener) and per-connection state.

### 5. Sticky sessions: not required

Cloud Run does not provide sticky sessions, and SSE does not need them:

* An SSE connection is a single long-lived HTTP request. Cloud Run
  routes it to one instance and keeps it on that instance for the
  connection's lifetime. There is no "subsequent request that needs to
  land on the same backend" — the stream is *the* request.
* The matching `POST /api/groups/{gid}/messages` (the actual chat
  send) goes through Cloud Run's normal load-balanced routing and may
  land on a different instance. That instance writes to Firestore.
* The instance holding the SSE connection observes the Firestore write
  through its own listener. Cross-instance fan-out is handled by
  Firestore itself, not by an in-process pub/sub.

This is the load-bearing reason the design picks Admin SDK listeners
over in-process pub/sub: in-process pub/sub would silently fail any
time the writer and reader landed on different instances, which is
~every time for a real Cloud Run service.

### 6. Cloud Run config: bump `--timeout` to 3600s; keep `min-instances=0`

Stock Cloud Run request timeout is 300 s. An SSE connection that lives
that long is the *point*, not a runaway — bumping the timeout to its
maximum (3600 s = 60 min) is required. After the timeout, the server
ends the connection cleanly; the client reconnects.

`min-instances` stays at 0:

* Cloud Run does not scale an instance to zero while it has in-flight
  requests, including an active SSE connection. So as long as at least
  one user has chat open, the instance stays warm "for free."
* Cold-start on the *first* SSE connect of a quiet period is the same
  ~2-4 s cold-start the polling path already pays. The fallback
  polling continues working through the cold start; the user is not
  blocked.
* Pinning `min-instances=1` would cost ~$15/mo (per the H3 review
  estimate in `infra/cloud-run.tf`). That fits inside the $50 budget,
  but the cost/benefit doesn't pencil out when warmth is already free
  during active usage.

If we ever see a complaint about chat-open latency after a long idle
period, raising `min-instances` is a one-line variable change in
`infra/cloud-run.tf`. Documented in the runbook.

### 7. Fallback: drop to the existing polling loop

`useGroupMessages` opens the stream on mount. If the stream:

* fails to open (network, 503 kill-switch, CORS, anything),
* drops mid-session, OR
* reconnect attempts exceed a threshold (currently 4 attempts inside a
  rolling window),

…the hook flips to the existing polling path and stays there for the
remainder of the session. Polling is paused while the stream is
healthy and resumes only on stream failure, so the steady-state cost
stays at "one open HTTP connection per active client" instead of
"polling + streaming."

Visibility-change handling mirrors the polling behaviour: the stream
closes when `document.hidden` becomes true and reopens on
visibilitychange. Background tabs stop holding stream slots open.

A kill-switch (`JACOB_MESSAGES_STREAM_DISABLED=1`) makes the endpoint
return 503 globally. That's the lever to pull if the stream surface
misbehaves in production — every client drops back to polling
automatically. Documented in the runbook.

## Cost analysis

### Per-user-hour Firestore reads, today vs. with SSE

Active chat user, polling baseline:

* `since=` poll every 10 s = 360 polls/hour.
* Server-side: 304 short-circuit roughly 95% of the time (steady-state
  empty deltas). The 5% that return a non-empty page each fan into
  ≤50 doc reads (page size) plus the M10 `_my_reactions_batch` ≤50
  reactions reads. Average ≈ 5 polls × 1 doc-read (the modal hit is
  one new message) = **5 reads/hour, plus 18 reads/hour for the
  reactions fetch on each of those 5 polls — ~25 reads/user/hour**.

Active chat user, SSE:

* No polling while connected.
* Each new message in the group costs 1 doc-read per active listener
  (one listener per instance). Average new-message volume per active
  group ≈ 30 messages/hour for a busy small group, ≈ 0 for an idle one.
* With (say) 3 instances active and one busy group: 3 listeners × 30
  msgs = **90 reads/hour total for that group**, amortised across
  however many users are viewing. With 10 viewers, that's
  **9 reads/user/hour** — a ~60% cut.

Worst case for SSE: a very chatty group with one viewer per instance.
Then it's 30 reads/hour for the viewer plus the listener reads — about
the same as polling. The break-even is around 1-2 viewers per listener;
chat is almost always above that.

Net: SSE is cheaper or comparable across the expected mix, and the
latency win is sub-second vs. 10 s.

### Cloud Run cost

The dominant cost shifts from per-request CPU (each poll wakes a
handler) to instance-hours (each SSE holds an instance slot). Cloud
Run charges on CPU-seconds while a request is active; an SSE
connection is "active" the whole time it's open, so it does pay CPU
time. But the CPU usage of an idle SSE handler (awaiting `queue.get`)
is near zero — Cloud Run bills for the slot, not for CPU activity, and
80 concurrent connections fit in one slot.

Forecast: with the existing $50 budget and current usage, the move
from polling to SSE should reduce billable request-count
substantially (fewer wake-ups), trade some of that back for longer
instance-hours, and net out roughly flat. We don't expect this PR to
push the staging budget toward the 50% alert threshold; if the budget
alert fires post-rollout, the kill-switch is the response (drop to
polling, investigate, re-enable).

## Consequences

* Sub-second new-message latency for the common case (SSE healthy).
* Polling stays as a working fallback. No behavioral regression for
  users on broken networks or aggressive corporate proxies.
* One new long-lived resource per (instance, active group):
  Firestore Admin listener. Per-instance memory grows with the number
  of *distinct active groups*, not active users. Monitor via the new
  runbook section.
* Hook contract unchanged — `useGroupMessages` returns the same
  fields. Callers don't need updating.
* Future-proofs the same pattern for boards, notifications, ministry
  feed, daily verse — but each gets its own ADR + endpoint when it
  ships. Out of scope here.
