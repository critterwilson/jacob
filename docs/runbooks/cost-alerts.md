# Cost alerts runbook

## What triggers an alert

Budget alerts fire by email to `alert_email` (set in your `terraform.staging.tfvars`).

| Budget | Amount | Thresholds | Managed by |
|--------|--------|------------|------------|
| JACOB staging — monthly (`google_billing_budget.staging`) | `billing_budget_usd` (default $50) | 50 % · 90 % · 100 % · 120 % | `infra/billing-budget.tf` |
| jacob-monthly-budget-staging (`google_billing_budget.monthly`) | `monthly_budget_usd` (default $150) | 50 % · 100 % | `infra/uptime-checks.tf` |

The $50 budget is the early-warning layer; the $150 budget is the ceiling. No automatic service shutoff is configured — all alerts are notification-only.

## When you receive an alert — where to look first

1. **Cloud Billing reports** filtered to the last 7 days, grouped by service:  
   `https://console.cloud.google.com/billing/011F58-EB11C1-9D0B34/reports?project=jacob-staging-494515`

2. The usual suspects ranked by cost:
   - **Cloud Run** (backend) — unexpected traffic or a stuck polling loop
   - **Firestore** reads/writes — an unbounded query, runaway listener, or missing index causing full scans
   - **Cloud Storage** — large uploads that weren't quarantined; egress from public bucket
   - **Secret Manager** — many accesses per second (indicates a missing cache)
   - **Cloud Vision / NL API** — a runaway moderation trigger in Cloud Functions

3. Check Cloud Monitoring → **Metrics Explorer** for the Firestore read-volume alert (`jacob-firestore-reads-staging`) — if it fired in the same window, that's likely your culprit.

## How to silence false alarms / raise the threshold

Edit `infra/billing-budget.tf` and bump `billing_budget_usd` (or change the variable in your `terraform.staging.tfvars`):

```hcl
# infra/terraform.staging.tfvars
billing_budget_usd = 75   # was 50
```

Then apply:

```bash
cd infra
terraform plan  -target=google_billing_budget.staging
terraform apply -target=google_billing_budget.staging
```

The Terraform SA needs `roles/billing.costsManager` on the billing account to apply budget changes (see the permissions note below).

## Permissions required to apply budget changes

The Terraform service account (`jacob-tf-wif@jacob-staging-494515.iam.gserviceaccount.com` or equivalent) needs:

```
roles/billing.costsManager   # on the billing account (011F58-EB11C1-9D0B34)
```

Grant it with:

```bash
gcloud billing accounts add-iam-policy-binding 011F58-EB11C1-9D0B34 \
  --member="serviceAccount:<tf-sa-email>" \
  --role="roles/billing.costsManager"
```

If the CI service account lacks this role, run `terraform apply` locally with owner credentials.

## This is alerts-only — no automatic shutoff

There is no Cloud Function or billing-disable hook attached to these budgets. A future follow-up could add a Pub/Sub push from the budget notification → Cloud Function → `gcloud billing projects unlink` (or Cloud Run `--max-instances 0`), but that is a heavy hammer and out of scope here.
