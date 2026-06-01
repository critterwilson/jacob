# Cost control runbook

How the `$10/mo` hard cap works, what happens when it fires, and how to recover.
Companion to the alert-only layers in `cost-alerts.md` and the inventory in
`cost-audit-2026-06.md`.

## The budget layers

| Budget | Amount | Scope | On breach | Defined in |
|--------|--------|-------|-----------|------------|
| **JACOB $10 hard cap (kill switch)** | **$10** | **billing account (all projects)** | emails + **disables billing** | `infra/billing-killswitch.tf` |
| JACOB staging — monthly | $50 | staging | email only | `infra/billing-budget.tf` |
| jacob-monthly-budget-staging | $150 | staging | email only | `infra/uptime-checks.tf` |

The `$10` budget is the only one with teeth. The `$50`/`$150` budgets remain as
early-warning layers. The legacy manually-created **"JACOB dev cap" $10** budget
is superseded by the kill switch — **delete it** so two budgets don't fire at the
same threshold:

```bash
gcloud billing budgets list --billing-account=011F58-EB11C1-9D0B34   # find its id
gcloud billing budgets delete <budget-id> --billing-account=011F58-EB11C1-9D0B34
```

## Who gets alerted, at which thresholds

The `$10` budget emails `christopherwilsontry@gmail.com` (the
`google_monitoring_notification_channel.email` channel) at:

- **50%** ($5), **75%** ($7.50), **90%** ($9) of actual spend — early warnings.
- **100%** ($10) of actual spend — this crossing **arms the kill switch**.
- **100% of forecast** — fires when month-end is *trending* over $10. Email only;
  the function ignores forecast crossings.

So Christopher sees `$5 → $7.50 → $9` warnings (and a forecast warning) well
before billing is ever cut.

## What happens when the kill switch fires

1. At 100% actual spend, the budget publishes a notification to the
   `billing-killswitch` Pub/Sub topic.
2. The `billing-killswitch` Cloud Function (gen2, `infra/functions/billing-killswitch/`)
   receives it, confirms `costAmount >= budgetAmount`, and calls
   `cloudbilling.projects.updateBillingInfo(billingAccountName="")` on each
   project in `killswitch_project_ids` (default: `jacob-staging-494515`).
3. With no billing account linked, **every billable service stops serving**:
   Cloud Run returns errors, Functions stop, Firestore/Storage reads fail.

**Data is NOT deleted.** Unlinking billing only stops *serving*; Firestore
documents, Storage objects, and Artifact Registry images are all retained. (GCP
does eventually reclaim resources on a long-unbilled project, but that is weeks
out and irrelevant to a same-day false trigger.)

### The exact disable call

```
POST https://cloudbilling.googleapis.com/v1/projects/{PROJECT_ID}/billingInfo
{ "billingAccountName": "" }
```

The function's service account (`jacob-killswitch@…`) holds
`roles/billing.projectManager` on each target project — the least-privilege role
that grants `resourcemanager.projects.deleteBillingAssignment`. It needs *no*
billing-account-level admin role.

## Recovery — after the kill switch fires

1. **Re-enable billing:**

   ```bash
   ./infra/scripts/restore-billing.sh
   # or: ./infra/scripts/restore-billing.sh <project-id> <billing-account-id>
   ```

   This runs `gcloud billing projects link …` and prints `billingEnabled: True`
   on success. Services recover within a minute or two.

2. **Find the cause before traffic resumes — or it just re-trips.** Open the
   billing report and look for the spike:

   `https://console.cloud.google.com/billing/011F58-EB11C1-9D0B34/reports?project=jacob-staging-494515`

   Usual suspects (from `cost-alerts.md`): a stuck Cloud Run autoscaler, an
   unbounded Firestore query, a runaway Vision/NL moderation loop, or a Secret
   Manager access storm.

3. **If it was a false trigger** (e.g. a one-off legitimate charge), bump the cap
   in `terraform.staging.tfvars` (`killswitch_cap_usd`) and `terraform apply`.

## Testing the wiring without going offline

Set `killswitch_dry_run = true` in tfvars and `terraform apply`. The function
then logs `[DRY_RUN] would unlink billing from …` instead of unlinking. Trigger
a test notification:

```bash
gcloud pubsub topics publish billing-killswitch \
  --message='{"budgetDisplayName":"test","costAmount":99,"budgetAmount":10}' \
  --project=jacob-staging-494515
# then check the function logs:
gcloud functions logs read billing-killswitch --region=us-central1 --gen2 \
  --project=jacob-staging-494515 --limit=20
```

You should see `engaging kill switch` + `[DRY_RUN] would unlink…`. Flip
`killswitch_dry_run = false` and re-apply to arm it for real.

## Where to check current spend

- **Billing report (authoritative):**
  `https://console.cloud.google.com/billing/011F58-EB11C1-9D0B34/reports`
- **Budgets:** `gcloud billing budgets list --billing-account=011F58-EB11C1-9D0B34`
- **CLI estimate without the console:** there is no billing-export dataset yet.
  Enabling one (Billing → Billing export → BigQuery export) makes
  `SELECT service.description, SUM(cost) …` queries possible; it costs only a few
  MB of BigQuery storage. Recommended but optional.

## Per-service caps and where they're configured

| Surface | Cap / guardrail | Where |
|---------|-----------------|-------|
| Whole account | $10 → billing disabled | `infra/billing-killswitch.tf` |
| Cloud Run (backend) | min=0, max=10 | `infra/cloud-run.tf` (`cloudrun_max_instances`) |
| Cloud Functions | min=0, max 5–20 | Firebase deploy config (`functions/`) |
| Artifact Registry | keep last 10 images, delete > 7 days | `infra/artifact-registry.tf` |
| Firestore markers | 7-day TTL on `_*events` | `infra/firestore-ttls.sh` |
| BigQuery | 90-day partition expiration | `infra/bigquery.tf` |
| Storage (media/backup/export) | lifecycle delete 14–90 days | `infra/buckets.tf`, `infra/exports.tf` |

## Non-GCP caps (manual — no API)

- **GitHub Actions:** set the personal-account spending limit to `$0` in the web
  dashboard (Settings → Billing → Spending limit). There is no API for personal
  accounts. Public repos (`jacob`) are free regardless; the private repos
  (`jwi`, `soh-archery`, `veneto-home-design`, `borderline_normal`) draw the
  included-minutes pool.
- **Cloudflare:** keep every project on the free Workers/Pages plan. None of the
  current projects use Durable Objects / D1 / R2 / Queues, so none need the paid
  plan.
- **Stripe / Resend / Cal.com / SendGrid / Sentry:** all on free or
  usage-proportional tiers; no fixed caps required at current volume.
