# Cost audit — 2026-06

Read-only audit of every billable surface across Christopher's projects, taken
2026-06-01. Drives the `$10/mo` hard-cap work (kill switch + preemptive
optimizations). Nothing was mutated to produce this document.

## TL;DR

- **Only GCP has meaningful spend risk.** Everything else (Cloudflare Workers,
  GitHub Actions on public repos, Stripe/Resend/Cal.com) sits on free or
  usage-proportional tiers far below `$10/mo`.
- **All GCP workload lives in `jacob-staging-494515`.** The "production"
  project `jacob-494515` is dormant — 0 Cloud Run services, 0 buckets, Cloud
  Functions + Firestore APIs disabled. Capping staging effectively caps all
  spend.
- **Estimated current spend: ~$1–3/mo**, dominated by Artifact Registry
  storage. No billing-export dataset exists, so this is a config-derived
  estimate, not an invoiced figure.
- **Three concrete risks** (detailed below): unbounded Artifact Registry image
  pileup, no Firestore TTL on idempotency markers, and a toothless `$10` budget
  with no enforcement wiring.

## Accounts & projects

| Item | Value |
|------|-------|
| Billing account | `011F58-EB11C1-9D0B34` ("jacob", OPEN) |
| Staging project | `jacob-staging-494515` (number `732806466572`) — **all workload** |
| Prod project | `jacob-494515` (number `337734086414`) — **dormant** |
| Region | `us-central1` (Firestore multi-region `nam5`) |

A second billing account `0196C3-A1A6E0-741612` exists but is closed/unused.

### Existing budgets (live, before this work)

| Budget | Amount | Scope | Thresholds | Notifications |
|--------|--------|-------|------------|---------------|
| `jacob-monthly-budget-staging` | $150/mo | staging | 50% · 100% | email channel |
| `JACOB dev cap` | $10/mo | staging + prod | 50% · 100% | **none — no channel, no Pub/Sub** |

Note: `infra/billing-budget.tf` defines a third `$50` early-warning budget
(`google_billing_budget.staging`) that is **not yet applied** to the live
account (only the two above exist live). None of the budgets had any automatic
shutoff — all were alert-only, and the `$10` "dev cap" alerted nowhere.

## Actual recent spend

**No Cloud Billing → BigQuery export is configured** on either project, so a
precise per-service invoice cannot be pulled from the CLI. The only dataset is
`jacob_analytics` (staging, 0 tables). Estimate from resource config:

| Service | Est. monthly | Basis |
|---------|-------------|-------|
| Artifact Registry | ~$0.90 | 9.28 GB stored × ~$0.10/GB-mo |
| Cloud Run / Functions | ~$0 | all scale-to-zero; negligible request volume |
| Firestore | <$0.50 | small dataset; free-tier reads/writes |
| Cloud Storage | ~$0 | all buckets measured 0 bytes |
| BigQuery | $0 | 0 tables |
| Everything else | ~$0 | Scheduler/Pub-Sub/Secret Manager within free tier |
| **Total** | **~$1–3/mo** | |

> Enabling a billing-export dataset would make this exact. It is itself nearly
> free (BigQuery storage of a few MB/day). Recommended but optional — tracked in
> the cost-control runbook.

## Inventory

### Cloud Run services (staging; prod has none)

All scale to **min-instances = 0** (no idle billing — good). The 14 `on*` /
`sendfcmtask` entries are the 2nd-gen Cloud Functions (same underlying Run
services, deployed via Firebase, not this Terraform).

| Service | min | max | CPU | Mem |
|---------|-----|-----|-----|-----|
| jacob-backend | 0 | 20 | 1 | 512Mi |
| jacob-frontend | 0 | 5 | 1 | 512Mi |
| onphotouploadfinalize, sendfcmtask | 0 | 20 | 1 | 256Mi |
| onmessage{create,tokenize,write}, onmemberwrite, onreactionwrite, onnotificationcreate, onboardpost{create,write}, onboardreactionwrite, onboardreplywrite, onministryreactionwrite | 0 | 10 | 1 | 256Mi |
| onministrypostcreate | 0 | 5 | 1 | 256Mi |

### Cloud Run jobs (staging; pay-per-run, idle otherwise)

`cleanup-stale-devices`, `finalize-deletions`, `firestore-export`,
`firestore-to-bigquery`, `process-export-jobs`, `weekly-digest`.

### Cloud Scheduler (staging, us-central1) — all ENABLED, none orphaned

`firestore-export-daily` (03:00), `finalize-deletions-daily` (03:30),
`firestore-to-bigquery-daily` (04:30), `cleanup-stale-devices-daily` (05:00),
`weekly-digest` (Sun 16:00), `process-export-jobs-5min` (*/5). Each maps to a
declared Cloud Run job — no orphans.

### Storage buckets (staging) — all measured 0 bytes

`jacob-backups-staging`, `jacob-exports-staging`, `jacob-media-public-staging`,
`jacob-media-quarantine-staging`, `jacob-staging-494515.firebasestorage.app`,
plus gcf-source and tf-state. Lifecycle rules already exist on the media /
backup / export buckets (`infra/buckets.tf`, `infra/exports.tf`). Storage is not
a cost factor today.

### Artifact Registry (staging)

| Repo | Size | Cleanup policy? |
|------|------|-----------------|
| **jacob-images** | **9.28 GB / 285 images** (all `jacob-backend`) | **NONE** ⚠️ |
| firebaseapphosting-images | 177 MB | yes (auto) |
| gcf-artifacts | 143 MB | yes (auto) |

The deployed backend image (`deebec8…`, pushed 2026-05-31) is the newest
version, so a keep-most-recent policy can prune safely.

### BigQuery

`jacob_analytics` (staging): exists, **0 tables, no default expiration**. No
guardrail for when the `firestore-to-bigquery` job starts landing daily
snapshots.

### Firestore TTL

**0 TTL policies configured live.** None of the idempotency-marker collection
groups have TTL: `_events`, `_reaction_events`, `_index_events`, `_post_events`,
`_reply_events`, `_member_events`, `moderation_text_events`. These accumulate
forever. The fix already exists in-repo (`infra/firestore-ttls.sh`) but has not
been run against staging.

### Pub/Sub

13 `eventarc-*` topics (function triggers). **No `budget` topic** — one must be
created for kill-switch enforcement.

## Non-GCP services

| Service | Used by | Tier / limit | Risk |
|---------|---------|--------------|------|
| Cloudflare Workers | borderline-normal, veneto-home-design (Pages, static), soh-archery (Workers + KV) | Free plan suffices — no Durable Objects / D1 / R2 / Queues / cron anywhere | **none** |
| GitHub Actions | private repos: `jwi`, `soh-archery`, `veneto-home-design`, `borderline_normal` (`jacob` is public = free) | included minutes pool | low |
| Stripe | soh-archery | per-transaction, no platform fee | low |
| Resend | soh-archery | 3,000/mo, 100/day free | low |
| Cal.com | soh-archery | free individual plan | low |
| SendGrid | jacob | free 100/day | low |
| Sentry | jacob | free dev tier | low |

**Could not retrieve via API** (documented, manual follow-up for Christopher):

- **GitHub Actions minutes used** — the `gh` token lacks the "Plan" read scope;
  `/user/settings/billing/*` returned 404/403. Read from
  Settings → Billing → Plans and usage.
- **GitHub Actions spending limit** — there is **no personal-account API** to set
  it (org-only endpoints exist). Must be set in the dashboard
  (Settings → Billing → Spending limit → set to `$0`).
- **Cloudflare plan / live worker list** — no `CF_API_TOKEN` available locally;
  audited from `wrangler.toml` config only.

## Top 3 cost risks

1. **Artifact Registry `jacob-images`: 9.28 GB / 285 images, no cleanup policy.**
   Every backend deploy adds an image and nothing prunes them — monotonic
   growth, and the largest current line item. _Mitigation: cleanup policy
   (keep last 10, delete > 7 days) — `infra/artifact-registry.tf`._
2. **No Firestore TTL on idempotency markers.** Unbounded document growth →
   rising storage + read cost over time. _Mitigation: run
   `infra/firestore-ttls.sh` (already authored, not yet applied)._
3. **No hard spend enforcement.** The `$10` budget alerted nowhere and nothing
   could stop runaway spend (a moderation-pipeline loop calling Vision/NL, a
   stuck Cloud Run autoscaler). _Mitigation: `$10` budget → Pub/Sub → Cloud
   Function that disables billing — `infra/billing-killswitch.tf`._

See `docs/runbooks/cost-control.md` for the enforcement design and recovery
procedure.
