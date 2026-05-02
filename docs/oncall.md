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
- **Frontend** — `NEXT_PUBLIC_SENTRY_DSN` (set in Firebase Hosting config or `.env.local`)

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
   `gcloud run services update-traffic jacob-api --to-revisions=PREV=100`.
5. **Firebase Hosting outage**: check the latest deploy in the Firebase console;
   roll back with `firebase hosting:rollback`.

## Escalation

If the incident is unresolved after 30 minutes, contact Christopher Wilson directly.
