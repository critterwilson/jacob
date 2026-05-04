# Leader / org analytics runbook (T60)

## What this is

Two surfaces:

* **`GET /api/groups/{gid}/analytics`** (T29 + T60) — per-group view
  for leaders. Returns the original T29 BigQuery output (sticker
  mix, top contributors, daily cadence) plus T60's Firestore-side
  fields: per-event attendance and a daily sentiment trend.
* **`GET /api/orgs/{orgId}/analytics`** (T60) — org-aggregated view
  for org admins. Rolls up across attached groups; returns
  per-group slices alongside org totals.

The org dashboard lives at `/orgs/[orgId]/analytics`.

## What each chart means — and what it doesn't

### `eventAttendance`

Per-event RSVP-going + actual-checkin counts for the last 30 days
(default). Source: `groups/{gid}/events/*` and their RSVP
subcollection.

* **Use it for**: noticing an event whose attendance kept dropping
  (something off about the time / topic), or one that punched
  above its RSVP count (worth repeating).
* **Don't use it for**: scoring members. The roster names are
  available to the leader for follow-up but the dashboard
  intentionally surfaces only counts.

### `sentimentTrend`

Daily average of `moderation_queue.severity` for the group, over
the last 30 days. Higher = more contentious content. Aggregate
only — there's no per-member breakdown.

* **Use it for**: seeing a sustained spike that suggests a
  brewing conflict or a member in crisis.
* **Don't use it for**: identifying *which* member is "the
  problem." The numbers don't carry uid; the moderation queue
  itself does, and the operator runbook is the right path for
  per-message review.
* **A flat zero** doesn't mean "everyone is happy" — it just
  means moderation didn't see anything. Use it as one signal
  among several.

### Existing (T29): `stickerMix`, `topContributors`, `cadenceByDay`

Unchanged. Still BigQuery-backed; gated by the
`jacob_analytics_enabled` env var.

### Org rollups: `groups[]`, `groupCount`, `activeMembers`,
`totalMessages`

* `groups[]` is the per-group slice (member count, approximate
  message count, attended events).
* `activeMembers` = unique uids in the org-member denorm
  (`orgs/{orgId}/members`).
* `totalMessages` is currently a heuristic (memberCount × 10) until
  the BigQuery view extension lands. Treat it as a relative number,
  not an absolute one. The runbook will update when the BQ aggregate
  ships.

## What we explicitly don't surface

* **Per-member sentiment.** Never. The unit test
  `test_sentiment_trend_buckets_by_day_no_per_uid_leak` asserts
  the bucket payload contains no `uid` / `actorUid` field.
* **Per-member retention.** Cohort retention is a Phase 3.5
  follow-up; v1 surfaces only org-level active count.
* **Predictive metrics ("this member will leave").** Out of scope
  for v1 — and the spec calls it out as never-do for the dashboard
  level.

## Refresh + cache

* BigQuery output is cached per `(gid, range)` for 1 hour
  (existing T29 behaviour).
* Firestore-derivable fields (events + sentiment) recompute on
  every request — the underlying queries are tiny.
* Org rollup recomputes per request; no cache today (volumes are
  org-admin-rate, ~tens of requests per day per pilot org).

## Operator follow-ups

* BigQuery views to back `engagement_weekly`, `retention_cohort`,
  and `prayer_response_weekly` (the latter only when T47 unparks).
  v1 ships with the spec's "Firestore is enough" path.
* Sentry alert on `org_aggregate` over a 5s p95 — not yet wired,
  but the right trigger when an org grows past ~20 groups.
