# JACOB On-Call Runbook

## Alert recipients

| Channel | Value |
|---------|-------|
| Email   | christopherwilsontry@gmail.com |
| Webhook | Set `alert_webhook_url` in `infra/uptime-checks.tf` (Slack/Discord webhook) |

Configure the webhook by setting the `alert_webhook_url` Terraform variable.
Leave it empty to receive alerts by email only.

## Uptime alerts

Two checks run every 60 seconds from multiple Cloud Monitoring regions:

| Check | Target | Alert threshold |
|-------|--------|----------------|
| Frontend | `<frontend_host>/` | 2 consecutive failures (≥ 2 min) |
| Backend health | `<backend_host>/health` | 2 consecutive failures (≥ 2 min) |

Alerts are rate-limited to **one notification per hour** per policy.

## Budget alerts

Initial monthly budget: **$150 USD**.

| Threshold | Action |
|-----------|--------|
| 50 % ($75) | Review recent Cloud Run, Vision API, and Firestore usage in the billing console |
| 100 % ($150) | Investigate immediately; consider disabling non-critical paid APIs |

## Sentry

Unhandled exceptions on backend and frontend flow to Sentry.
PII scrubbing is applied before transmission: email addresses and request
bodies are stripped from all events.

DSN configuration:
- **Backend** — `SENTRY_DSN` environment variable (Secret Manager → Cloud Run)
- **Frontend** — `NEXT_PUBLIC_SENTRY_DSN` (set in App Hosting environment config or `.env.local`)

Sentry environment:
- **Backend** — `SENTRY_ENVIRONMENT` (e.g. `staging`, `production`)
- **Frontend** — `NEXT_PUBLIC_SENTRY_ENVIRONMENT`

## Structured logs

Every backend request emits a JSON log line to stdout:

```json
{
  "request_id": "uuid",
  "uid": "firebase-uid-or-null",
  "route": "/api/groups",
  "method": "POST",
  "status": 200,
  "latency_ms": 42.1
}
```

Cloud Logging on Cloud Run picks this up automatically.
Query in Cloud Logging: `resource.type="cloud_run_revision" jsonPayload.status>=500`

The `request_id` is also returned in the `X-Request-ID` response header so
client-side errors can be correlated with backend logs.

## First-response steps

1. Check the failing uptime alert in Cloud Monitoring.
2. Search Cloud Logging for recent 5xx entries on the affected service.
3. Open Sentry and filter by the `request_id` if available.
4. **Cloud Run outage**: inspect the latest revision; roll back via the console or
   `gcloud run services update-traffic jacob-backend --to-revisions=PREV=100`.
5. **App Hosting outage**: list recent rollouts with
   `firebase apphosting:rollouts:list --project <PROJECT_ID> --backend <BACKEND_ID>`
   then delete the bad rollout with
   `firebase apphosting:rollouts:delete <ROLLOUT_ID> --project <PROJECT_ID>`
   to revert to the previous revision.

## Escalation

If the incident is unresolved after 30 minutes, contact Christopher Wilson directly.

## Rotation (T59)

Two-person rotation, weekly handoff every Tuesday 09:00 local. While
the team is a single engineer, the secondary slot stays empty and
PagerDuty pages the same number twice (15 minutes apart) before
escalating. When the second on-call hire lands, the rotation flips
to a real two-person cadence.

| Week of | Primary | Backup |
|---------|---------|--------|
| 2026-05-04 | Christopher Wilson | (vacant) |
| 2026-05-11 | Christopher Wilson | (vacant) |

Update this table at handoff. If you swap a week with someone, update
the table FIRST, then announce in #incidents. Calendar matters more
than memory.

## Severity definitions

See `docs/runbooks/incident.md` § "Severity definitions" for the full
matrix. Quick reference:

* **SEV1** — production outage; multi-user. Page 24/7.
* **SEV2** — production degraded; one surface broken. Page in
  business hours.
* **SEV3** — bug or paper cut; no data loss. Issue tracker.

## Incident playbook

`docs/runbooks/incident.md` is the step-by-step playbook for any
SEV1/2 declaration. Read it cold once a month so you don't have to
read it under stress.

## Postmortems

Every SEV1/2 produces a postmortem within 5 business days of
resolution. Use the template at `docs/postmortem-template.md`. File
in `docs/postmortems/<YYYY-MM-DD>-<slug>.md`.

## In-app incident banner

The on-call can flip a non-dismissible banner on every authed page
via `/admin/incidents` or `POST /api/admin/incidents`. The doc lives
at `active_incidents/{incidentId}` and is read by every client via
`GET /api/incidents` (60-second client revalidation).

The banner is intentionally separate from the public status page:
internal SEV3 banners shouldn't leak to status.jacob.app, and a
status-page incident shouldn't auto-flip the in-app banner without
the on-call considering it.

## External status page

`status.jacob.app` (Better Stack Status, free tier — see ADR 0009).
Components: web, API, push, search, moderation. Update during every
SEV1/2 declaration; flip back to operational at resolution.
