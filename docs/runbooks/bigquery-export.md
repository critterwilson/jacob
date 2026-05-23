# Runbook: Firestore → BigQuery analytics export (T29)

## Overview

A Cloud Run Job (`firestore-to-bigquery`) runs at **04:30 UTC** every day.
It reads the previous day's Firestore export from GCS and loads it into
BigQuery table `jacob_analytics.messages_raw_YYYYMMDD` using `WRITE_TRUNCATE`
(idempotent — running twice for the same day is safe).

Three SQL views (`messages_daily`, `sticker_mix_weekly`,
`top_contributors_weekly`) are built over the raw tables and queried by the
FastAPI analytics endpoint at `GET /api/groups/{gid}/analytics`.

**Daily lag:** Data from today will not appear in the dashboard until
tomorrow's loader runs. The UI shows "Includes through yyyy-mm-dd" to make
this explicit.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | (Cloud Run injects) | GCP project |
| `BQ_ANALYTICS_DATASET` | `jacob_analytics` | BigQuery dataset |
| `BQ_BACKUPS_BUCKET` | — | GCS bucket with daily exports |
| `EXPORT_DATE` | yesterday | Override for backfill |
| `JACOB_ANALYTICS_ENABLED` | `false` | Set `true` to enable the API endpoint |

---

## Initial deployment

1. Apply Terraform — `infra/cloud-run-jobs.tf` defines the
   `firestore-to-bigquery` Cloud Run Job and `infra/scheduler.tf` defines
   the daily Cloud Scheduler trigger; both are created by a single
   `terraform apply -var-file=terraform.${ENV}.tfvars`. The job runs from
   the shared `jacob-backend` image — no separate image build is needed.
2. Apply the SQL views (substitute `${project}`):
   ```sh
   sed "s/\${project}/${PROJECT}/g" infra/bigquery/views.sql | bq query --use_legacy_sql=false
   ```

3. Set `JACOB_ANALYTICS_ENABLED=true` on the backend Cloud Run service.

4. Confirm the scheduler is live:
   ```sh
   gcloud scheduler jobs list --project ${PROJECT} --location us-central1 \
     | grep firestore-to-bigquery-daily
   ```

---

## Initial backfill (last 30 days)

Run the loader once per day, from oldest to newest:

```sh
for d in $(seq 30 -1 1); do
  DATE=$(date -u -d "${d} days ago" +%Y-%m-%d 2>/dev/null || \
         date -u -v-${d}d +%Y-%m-%d)
  echo "Loading ${DATE}…"
  EXPORT_DATE=${DATE} python infra/scheduled/firestore_to_bigquery.py
done
```

Or trigger the Cloud Run Job with the env override:

```sh
gcloud run jobs execute firestore-to-bigquery \
  --region us-central1 \
  --update-env-vars EXPORT_DATE=2026-04-01
```

---

## Schema migration

If new fields are added to the `messages` Firestore collection:

1. Re-run the loader for any date after the field was introduced — the
   `autodetect=True` option on the external table will pick up the new schema.
2. Update `infra/bigquery/views.sql` to reference the new field.
3. Re-apply the views with the `bq query` command above.
4. No Firestore rule changes are needed (server-side export).

---

## Cost controls

- The FastAPI analytics service passes `maximum_bytes_billed = 10 GiB` to
  every BigQuery query. Queries that would scan more data are cancelled with
  an error (the endpoint returns 503 `not_yet_loaded`).
- At current message volume, queries scan < 100 MB per run. The 10 GiB cap
  is a safety net for unexpected data growth.
- The Scheduler job fires once per day; the FastAPI endpoint caches responses
  for 1 hour per (gid, range) pair in-process.

---

## Alerts

| Signal | Action |
|---|---|
| Loader job exits non-zero | PagerDuty via Cloud Monitoring job-failure alert |
| Analytics endpoint returns 503 consistently | Check loader logs; data may not be available yet |
| `bq_quota_exceeded` log line | Raise the `maximum_bytes_billed` cap or investigate runaway query |

---

## Admin shortcut

A platform admin (custom claim `admin: true`) can view any group's analytics
dashboard regardless of membership. This is intentional — document it in the
access review.
