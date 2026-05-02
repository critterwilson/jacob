# Firestore Restore Runbook

Covers restoring from a daily or weekly Firestore export stored in
`gs://jacob-backups-{env}/`. Follow this end-to-end against the dev project
before the first production incident — the drill is part of T16's acceptance
criteria.

---

## 1. Prerequisites

| Tool | Minimum version |
|------|-----------------|
| `gcloud` CLI | 400.0.0 |
| Firebase CLI | 12.0.0 |

You need the `roles/datastore.importExportAdmin` role on the target project
and `roles/storage.objectViewer` on the backup bucket.

```bash
gcloud auth login
gcloud config set project <TARGET_PROJECT_ID>
```

---

## 2. Find the export to restore from

List available daily exports (most recent first):

```bash
BACKUP_BUCKET="jacob-backups-prod"   # or jacob-backups-staging

gcloud storage ls "gs://${BACKUP_BUCKET}/daily/" | sort -r | head -10
```

For weekly snapshots:

```bash
gcloud storage ls "gs://${BACKUP_BUCKET}/weekly/" | sort -r | head -5
```

Pick a `{PREFIX}`, e.g. `gs://jacob-backups-prod/daily/2026-04-30`.

---

## 3. (Dev/drill only) Copy the export to the target project's accessible path

If restoring into a **different project** (recommended for drills — never
restore prod data directly into prod without a change window):

```bash
SOURCE_PREFIX="gs://jacob-backups-prod/daily/2026-04-30"
TARGET_BUCKET="jacob-backups-dev"   # must exist in the target project
TARGET_PREFIX="gs://${TARGET_BUCKET}/restore/2026-04-30"

gcloud storage cp --recursive "${SOURCE_PREFIX}" "${TARGET_PREFIX}"
# Typical time: 2–5 minutes for a small database, longer for large ones.
# Record actual time: _____ min
```

Skip this step when restoring within the same project.

---

## 4. Import into Firestore

```bash
IMPORT_PREFIX="${TARGET_PREFIX}"   # or SOURCE_PREFIX if same project

gcloud firestore import "${IMPORT_PREFIX}" \
  --project=<TARGET_PROJECT_ID>
```

This is an **additive** import by default — existing documents are
overwritten if their paths match, but documents not in the export are left
in place. To restore to a clean state, delete all data first:

```bash
# WARNING: irreversible. Only do this on a non-production project.
firebase firestore:delete --all-collections --project=<TARGET_PROJECT_ID>
```

Then re-run the import.

Typical import time for a small database: 3–8 minutes. Record actual: _____ min

---

## 5. Verify the restore

1. Sign in to the dev app with a known test account.
2. Confirm at least one group is visible and its message history loads.
3. Spot-check in the Firebase console: open Firestore → browse
   `groups/{gid}/messages` and confirm document counts look reasonable.

```bash
# Quick CLI check — count top-level collections
gcloud firestore databases describe --project=<TARGET_PROJECT_ID>
```

---

## 6. Timing notes

Fill in during the drill and commit the update.

| Step | Duration |
|------|----------|
| Locate export in bucket | _____ min |
| Copy export to target bucket (step 3) | _____ min |
| `gcloud firestore import` (step 4) | _____ min |
| Verification (step 5) | _____ min |
| **Total** | _____ min |

---

## 7. Scheduler configuration reference

The export job runs as a Cloud Run Job triggered by Cloud Scheduler:

| Schedule | Cron | Destination |
|----------|------|-------------|
| Daily | `0 3 * * *` | `gs://jacob-backups-{env}/daily/{YYYY-MM-DD}/` |
| Weekly (implicit in daily job, Sundays) | same | `gs://jacob-backups-{env}/weekly/{YYYY-Www}/` |

The job source is `infra/scheduled/firestore_export.py`. Required env vars:

| Variable | Example value |
|----------|---------------|
| `GCP_PROJECT_ID` | `jacob-prod` |
| `BACKUP_BUCKET` | `jacob-backups-prod` |

---

## 8. Troubleshooting

**Import fails with `ALREADY_EXISTS`**
Firestore rejects imports if the database is not empty and the import
encounters a collision at the collection level (rare). Delete the conflicting
collection manually or delete all collections (step 4) and retry.

**`gcloud firestore import` times out in the CLI**
The import runs asynchronously. The CLI timeout does not abort the operation —
check progress in Cloud Console → Firestore → Import/Export or:

```bash
gcloud firestore operations list --project=<TARGET_PROJECT_ID>
```

**Bucket permission denied during copy**
Ensure your identity has `roles/storage.objectViewer` on `jacob-backups-prod`
and `roles/storage.objectAdmin` on the target bucket. Service account
impersonation may be required in prod:

```bash
gcloud storage cp --recursive \
  --impersonate-service-account=backup-sa@jacob-prod.iam.gserviceaccount.com \
  "${SOURCE_PREFIX}" "${TARGET_PREFIX}"
```
