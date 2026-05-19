# Runbook — Realtime chat (SSE)

The chat surface (`useGroupMessages`) ships M5: a Server-Sent Events
stream primary + the existing 10s polling as fallback. This runbook
covers the operational playbook for when the stream misbehaves.

For the design rationale see `docs/adr/0013-sse-realtime-chat.md`.

## Topology

```
Browser  ──open GET /api/groups/{gid}/messages/stream──▶  Cloud Run (FastAPI)
                                                          │
                                                          ▼
                                                  StreamHub (per process)
                                                          │
                                          one Admin SDK listener per active group
                                                          │
                                                          ▼
                                                       Firestore
```

* Each Cloud Run instance owns its own `StreamHub`.
* Each `StreamHub` opens at most one Firestore listener per active
  group. The listener tears down when the last subscriber for that
  group drops.
* SSE connections themselves are pinned to the instance they land on.
  No sticky-session config needed.

## Symptoms → first check

### "Messages don't appear in real time, the 10s poll is the only thing that updates the UI"

1. Open devtools → Network → Filter: `stream`. Confirm the `/api/groups/{gid}/messages/stream` request is open and shows status 200.
2. If the request is missing or red:
   * Look at the response in detail — a 503 means the kill-switch is on (`JACOB_MESSAGES_STREAM_DISABLED=1` on the Cloud Run env). Unset it on the service or via `gcloud run services update jacob-backend --update-env-vars JACOB_MESSAGES_STREAM_DISABLED=0`.
   * 401 means the Firebase ID token didn't attach. Look at the client console for an auth error.
   * 403 means the user isn't a member of the group. Expected for the test cases; otherwise a membership-state bug.
3. If the request is open but no `event: message` frames are landing:
   * Check Cloud Logging for `stream_listener_attach_failed` lines — Firestore listener attach can fail on permission issues or a stale credential. The Admin SDK retries internally; sustained failure shows in logs.
   * Check Firestore IAM. The Cloud Run SA (`google_service_account.jacob_api`) needs `roles/datastore.user` to attach listeners. This is the same permission used for normal API reads — if reads work, listeners should too.
4. Verify the polling fallback engaged: look in the browser console for `stream_giving_up` or `stream_open_failed_giving_up`. If you see them, the client gave up on SSE — that's the expected fall-through.

### "I'm seeing Firestore-read alerts on the budget dashboard"

The StreamHub keeps at most one listener per active group per instance. Cost should be roughly `(active groups) × (active instances)` listener-streams, plus one read per change event per listener.

If reads are climbing fast:

1. `gcloud run services describe jacob-backend --region=us-central1` — confirm `min_instance_count: 0` (default) and `max_instance_count: 10`. If max is higher, every extra instance multiplies listener cost.
2. Search Cloud Logging for `stream_listener_attached` in the last hour. The cardinality of distinct `gid=` values × instance count is the listener count.
3. Compare to the Firestore reads metric in Cloud Monitoring. A typical chat-heavy small group churns ~30 writes/hour; with three instances and ten groups active that's ~900 listener-driven reads/hour, well inside the free tier.
4. If a single group is fanning out unusual traffic (a runaway script or a stuck client looping reconnects), the rate limit (`60/hour` per IP, `MESSAGES_STREAM_OPEN` in `backend/app/limits.py`) will throttle. Cloud Logging shows `RateLimitExceeded` for the offender.

If reads are dominantly listener-driven and we can't reduce the active-group count, the escape hatch is the kill-switch (see below) — clients drop back to polling, which is also bounded by `MESSAGES_LIST=60/minute`.

### "Cloud Run instance count is pinned high"

Cloud Run does not scale an instance to zero while it has in-flight
requests, including an SSE connection. A held connection keeps an
instance warm — by design. If the count is unexpectedly high:

1. `gcloud run services describe jacob-backend --region=us-central1 --format='value(status.traffic[0].revisionName,spec.template.spec.containers[0].image)'` — verify the revision in front is current.
2. Active connections per instance can be sampled via the **Cloud Run → Concurrency** chart. Concurrency below the per-instance limit (default 80) means there's headroom; if it's at the cap, autoscaler is doing the right thing.
3. If revision rotation has stuck on draining (old revision still serving streams that never close), the lifespan-shutdown hook is supposed to detach listeners and break the streams within the 10s SIGTERM grace. Check Cloud Logging for `stream_hub_shutdown listeners_detached=N` — if missing, the hook didn't fire (gunicorn pre-fork or async-misconfig). File a bug.

## Levers

### Hard kill-switch (everyone falls back to polling)

```bash
gcloud run services update jacob-backend \
    --region=us-central1 \
    --update-env-vars JACOB_MESSAGES_STREAM_DISABLED=1
```

Every subsequent SSE request gets a `503 stream_disabled`. The client
treats it as a stream-error and immediately starts polling. After the
5-strike give-up threshold the client stops trying to reopen at all
for that session.

To re-enable:

```bash
gcloud run services update jacob-backend \
    --region=us-central1 \
    --update-env-vars JACOB_MESSAGES_STREAM_DISABLED=0
```

### Cloud Run request timeout

Set to 3600s (the maximum) in `infra/cloud-run.tf` because SSE
connections need to hold for a long time. After the timeout the
server cleanly ends the stream; the client reconnects. Don't lower
this below ~600s without checking — short timeouts will cause visible
client reconnect storms.

### Bumping `min-instances`

If the first SSE connect after an idle period takes too long (the
cold-start tax), set `cloudrun_min_instances=1` in the Terraform
variable. Cost estimate from H3: ~$15/mo. Within the $50 budget but
not free.

The cold-start latency only hits the *first* SSE connect of a quiet
period because Cloud Run keeps the instance warm for the lifetime of
any in-flight request. As long as one user has chat open, the next
user reconnecting lands on a warm instance.

### Adjusting reconnect backoff

Client-side schedule lives in `frontend/lib/hooks/useGroupMessages.ts`
(`STREAM_BACKOFF_MS`). It's array-literal so changes are mechanical.
Don't push it below 200ms — a stuck server-side error would loop the
client into a hot-reconnect cycle and hit the `MESSAGES_STREAM_OPEN`
rate limit, which then surfaces as a 429 in the user's session.

## Postmortems should always check

* `stream_listener_attached` / `stream_listener_detach_failed` / `stream_hub_shutdown` log lines around the incident window.
* Per-user "dropped events" counter (logged at WARNING) — sustained drops indicate a slow consumer or a client-side rendering bug stalling the queue drain.
* Firestore reads/min trend during the incident vs. the prior week's baseline.
* Cloud Run instance count and concurrency during the incident.

## Known limitations (intentional in v1)

* Edits and soft-deletes of messages older than the stream's open-time don't push live — clients see them on next page refresh or after the stream reconnects. See ADR 0013 § 4.
* Hard-deletes don't push (we use soft-delete in M4; a true REMOVED change shouldn't happen for the chat path).
* Thread replies (`useThreadMessages`) still poll only.
* Boards, notifications, and the ministry feed still poll only.

Extending SSE to those surfaces is "same pattern, different endpoint" — each gets its own ADR + PR when prioritised.
