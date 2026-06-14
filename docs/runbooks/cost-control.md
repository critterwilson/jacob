# Cost control runbook

How the `$10/mo` hard cap works, what happens when it fires, and how to recover.
Companion to the alert-only layers in `cost-alerts.md` and the inventory in
`cost-audit-2026-06.md`.

## Applying the cost controls (one-time operator steps)

The Terraform and scripts that implement the cap are merged to `main`, but **CI
does not auto-apply infra** — nothing below is live until an operator runs it
with owner credentials. Run these in order. Each is safe and idempotent unless
noted.

> Why these are run by hand: applying them mutates the shared staging project
> (creating a billing-disable capability, deleting container images, enabling
> Firestore TTL). They are deliberately gated behind an operator + a plan
> review rather than executed automatically.

### 1. Rehearse, then arm the kill switch (Terraform)

```bash
cd infra
terraform init                      # if not already initialised for this env

# Review the plan FIRST — it creates the budget, Pub/Sub topic, gen2 function,
# the jacob-killswitch SA + roles/billing.projectManager, and ADOPTS the
# existing jacob-images repo via the import block. Confirm nothing unexpected
# is being destroyed (the artifact-registry import should show "will be
# imported", not "destroyed and recreated").
terraform plan

# Rehearse without going offline: set killswitch_dry_run = true first.
#   echo 'killswitch_dry_run = true' >> terraform.staging.tfvars
terraform apply

# Test-publish a fake breach and confirm the function logs the (dry-run) disable:
gcloud pubsub topics publish billing-killswitch \
  --message='{"budgetDisplayName":"test","costAmount":99,"budgetAmount":10}' \
  --project=jacob-staging-494515
gcloud functions logs read billing-killswitch --region=us-central1 --gen2 \
  --project=jacob-staging-494515 --limit=20      # expect "[DRY_RUN] would unlink…"

# Arm for real: flip killswitch_dry_run = false and re-apply.
terraform apply
```

### 2. Apply the Artifact Registry cleanup (reclaims ~9 GB)

This is included in the `terraform apply` above (the `jacob_images` resource +
cleanup policy). To apply it on its own, or without Terraform:

```bash
# Targeted Terraform:
terraform apply -target=google_artifact_registry_repository.jacob_images

# OR pure gcloud (preview first with --dry-run, then apply for real):
gcloud artifacts repositories set-cleanup-policies jacob-images \
  --location=us-central1 --project=jacob-staging-494515 \
  --policy=infra/artifact-registry-cleanup-policy.json --dry-run
gcloud artifacts repositories set-cleanup-policies jacob-images \
  --location=us-central1 --project=jacob-staging-494515 \
  --policy=infra/artifact-registry-cleanup-policy.json
```

Keep-most-recent-10 protects the live image (it is always the newest), so a
running Cloud Run revision is never pruned.

### 3. Enable Firestore TTL on the idempotency-marker collections

The audit found **0 TTL policies live**. The script is idempotent (re-running is
a no-op):

```bash
bash infra/firestore-ttls.sh jacob-staging-494515
# verify:
gcloud firestore fields ttls list --project=jacob-staging-494515 --filter='ttlConfig:*'
```

### 4. Keep a single budget (consolidation)

The kill-switch budget is the only one needed — it alerts *and* enforces. Older
revisions had extra $50/$150 alert-only budgets and a manual "JACOB dev cap"; all
have been removed. If any redundant budget resources are still in state, destroy
them (targeted, so the rest of the infra is untouched):

```bash
terraform apply -var-file="terraform.staging.tfvars" \
  -target=google_billing_budget.monthly \
  -target=google_billing_budget.staging \
  -target=google_billing_budget.early_warning
# (these resources no longer exist in config, so a targeted apply destroys them)
```

### 5. Non-GCP caps (dashboard / no API — manual)

- **GitHub Actions:** set the personal-account spending limit to **$0** at
  Settings → Billing → Spending limit. No API exists for personal accounts.
  Public repos (`jacob`) are free regardless.
- **Cloudflare:** keep every project on the free Workers/Pages plan (none use
  Durable Objects / D1 / R2 / Queues, so none need the paid plan).

## The budget layers

| Budget | Amount | Scope | On breach | Defined in |
|--------|--------|-------|-----------|------------|
| **JACOB $10 hard cap (kill switch)** | **$10** | **billing account (all projects)** | emails + **disables billing** | `infra/billing-killswitch.tf` |

This is the **single** budget by design. It both alerts (50/75/90/100% +
forecast) and enforces (disables billing at $10 actual spend). Earlier revisions
carried separate $50 and $150 alert-only budgets plus a manual "JACOB dev cap" —
all consolidated away, because once everything was set to $10 the extras only
produced duplicate alert emails without adding any protection.

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
