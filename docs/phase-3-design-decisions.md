# Phase 3 — DESIGN-OPEN resolutions

**Status:** Recommendations awaiting rubber-stamp
**Date:** 2026-05-03
**Resolves:** All 6 DESIGN-OPEN items in `docs/phase-3-impl-spec.md` § 6
**Companion ADRs (to be written at implementation time):** 0006 (T47),
0008 (T57), 0009 (T59), 0010 (T63). T55 does not need its own ADR; the
recommendation here is captured in the spec inline.

---

## How to read this document

Each of the 6 DESIGN-OPEN items has a short, six-field section:

- **Question** — the actual decision in one sentence.
- **Options considered** — what was on the table.
- **Recommendation** — the path the spec should take.
- **Why** — the reasoning, with citations where pricing or product
  state was the driver.
- **Cost impact** — concrete dollar figure (or "$0") and the trigger
  that would change the answer.
- **Reversibility** — how hard it would be to switch later.

These are recommendations, not commitments. Anything here can be
overridden by writing the actual ADR with countervailing data.

A few cross-cutting constraints govern every recommendation below:

1. **No paid external services for v1.** The CLAUDE.md "money
   constraint" (echoed in ADR 0005) forces the free-tier path
   wherever a free tier exists. Where a paid plan is unavoidable
   (LiveKit minutes past 10k, Cloud LB hours), we recommend
   shipping with the free option and documenting the upgrade
   trigger.
2. **Reversibility beats optimality.** Phase 3 ships features that
   may not survive contact with users. We pick the option that's
   easiest to walk back, not the one that's "best" at scale.
3. **Operability matters more than features.** A paging tool that
   the on-call actually carries (their phone) beats a feature-rich
   tool they ignore. A status page the user trusts beats a
   beautiful one nobody sees.
4. **Pricing in this doc is current as of 2026-05.** All vendor
   tier limits cited may have shifted by the time T57/T59/T63
   actually get implemented (months out). Re-verify before
   provisioning. Each section flags the specific number to
   re-check.

---

## 1. T57 — LiveKit hosting (Cloud vs self-hosted)

### Question

For Phase 3 voice rooms, do we use LiveKit Cloud (managed) or
self-host LiveKit on GCP (Compute Engine or GKE), and at what
scale does the answer change?

### Options considered

| Option | Cost shape | Ops burden | Scale ceiling |
|--------|-----------|------------|---------------|
| LiveKit Cloud — Build (free) tier | $0 up to quota | None | 5,000 WebRTC participant minutes / month |
| LiveKit Cloud — Ship/Scale (paid) | Per-minute, post-free-tier | Minimal (account + secrets) | Effectively unlimited |
| Self-host on Compute Engine (single VM) | ~$25–50/mo for an `e2-medium` + bandwidth | Significant: TURN config, autoscaling, OS patching, on-call burden | Constrained by single-VM CPU/network |
| Self-host on GKE (multi-node) | $75+/mo before any traffic | Very high: cluster, mesh, certs, scaling, monitoring | Effectively unlimited, but only if we operate it well |

### Recommendation

**LiveKit Cloud, Build (free) tier.** Wire the spec's `LIVEKIT_HOST`
env var so the production endpoint is `wss://<project>.livekit.cloud`
and the API key/secret come from Secret Manager. Treat the
`voice_per_org_monthly_cap_minutes` (default 1000 in T57) as the
*real* hard limit, and keep the *aggregated* cap across all orgs at
4,000 minutes/month so we stay safely inside the 5,000-minute
free-tier quota with headroom for QA traffic.

### Why

- The free Build tier on LiveKit Cloud advertises **5,000 WebRTC
  participant minutes / month, 50 GB egress, 1,000 agent minutes,
  no credit card required**. ([LiveKit Cloud quotas][lk-quotas],
  [LiveKit pricing][lk-pricing])
- Phase 3 caps voice rooms at 10 concurrent participants and
  routes opt-in via a flag (T58 rollout: 0% → 5% → 25% → 100%).
  At 5% rollout across two pilot orgs, even daily 30-minute rooms
  stay well under 5,000 minutes/month. We will hit the free-tier
  ceiling only once voice is genuinely popular, at which point
  the per-minute paid tier is the right answer anyway and we'll
  have usage data to justify the spend.
- Self-hosting is a misuse of the team's time at this scale. The
  ops list is non-trivial: TURN servers and STUN, ICE candidate
  filtering, codec config, autoscaling under bursty load, certs,
  patching, and the moderation workflow ("kill the room") still
  has to be wired up regardless of who runs the SFU. None of
  that is differentiated work for JACOB.
- Self-hosting also doesn't actually save money at our scale.
  An `e2-medium` VM idle costs roughly the same as 1,500 paid
  LiveKit minutes/month. We won't have those minutes for a long
  time.
- The "regulatory / cost data" exit clause from spec § 6 #1
  remains intact: if a future church partner has a hard data-
  residency requirement that LiveKit Cloud can't satisfy
  (they're US-based), that's the trigger to revisit. Until that
  trigger fires, defer.

### Cost impact

- **v1: $0/month.** Free tier covers expected usage with margin.
- **Trigger to upgrade:** sustained > 4,000 WebRTC minutes/month
  for two consecutive months, OR a partner org with a data-
  residency contract clause. At that point evaluate LiveKit Ship
  (per-minute, ~$0.005/participant-minute as of 2026-05) vs.
  self-hosting on a known traffic profile.
- **Hard cap to enforce in code:** `voice_per_org_monthly_cap_minutes`
  default 1000 (already in spec). Add a *global* env var
  `LIVEKIT_GLOBAL_MONTHLY_CAP_MINUTES` defaulting to 4000 and
  fail-closed at 90% with a Sentry alert at 75%. Cost-cap test
  in spec already covers per-org; extend to global.

### Reversibility

**High.** LiveKit Cloud and self-hosted LiveKit run the same
server-side protocol; switching is a config change to
`LIVEKIT_HOST`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. No
client-side change. Migration window is "next deploy." The only
sticky bit is project-scoped recordings — which we're not
building in v1 — so there's no historical state to migrate.

---

## 2. T59 — Paging tool (PagerDuty vs Opsgenie vs free alternatives)

### Question

Which on-call paging service should T59 wire up to deliver SEV1
phone alerts to the on-call engineer?

### Options considered

| Option | Free-tier cap | Phone alerts on free? | Notes |
|--------|--------------|------------------------|-------|
| PagerDuty Free | 5 users, 1 escalation policy | **Yes — 100 SMS+phone/month** | No credit card required; integrations limited |
| Opsgenie Free | 5 users | **No — email + push only**, 100 SMS/month account-wide, no voice | End-of-sale 2025-06-04, EOL 2027-04-05 — being merged into Jira Service Management |
| Better Stack On-Call | Free tier exists for monitoring + status; on-call paid | Limited on free | Tightly integrates with their status page (which we're also using — see § 3) |
| Cloud Monitoring native (email + SMS notification channels) | Generous monthly free tier on metric ingestion (150 MiB) and 1M API calls; SMS channel itself is free but not fully reliable | **Yes (SMS channel) — but Google explicitly warns SMS is unreliable, region-limited, and recommends a backup channel** | Already in our stack; no new vendor |
| Manual: Cloud Monitoring → email → phone-vendor SMS gateway | $0 | Email-to-SMS depends on carrier | Brittle |

### Recommendation

**PagerDuty Free for v1.** Wire the spec's `infra/oncall/pagerduty.tf`,
not `opsgenie.tf`. Cloud Monitoring stays as the *source* of alerts
(metrics, uptime checks, log-based), and PagerDuty becomes the
*router* via the existing GCP → PagerDuty integration. Drop
Opsgenie from the spec entirely.

### Why

- **PagerDuty Free includes 100 phone+SMS notifications per month
  at no cost for up to 5 users with no credit card.** That is a
  qualitatively better fit for a SEV1 page-the-engineer flow
  than Opsgenie's free tier, which gives email + push only and
  caps SMS at 100/month **with no voice at all**.
  ([PagerDuty Free 2026][pd-free], [Opsgenie Free 2026][og-free])
- **Opsgenie is sunsetting.** Atlassian announced end-of-sale
  2025-06-04 and end-of-support 2027-04-05; capabilities are
  migrating into Jira Service Management. Picking it now means
  picking a planned-migration vendor for a feature that's
  inherently sticky (everyone memorizes the page-from number).
  Hard pass. ([Opsgenie EOL notice][og-eol])
- **Cloud Monitoring SMS alone isn't enough for SEV1.** Google's
  own docs warn that the SMS channel is "not fully reliable,"
  may not deliver in all regions, and explicitly recommend
  pairing it with another channel. SEV1 phone wake-ups need a
  vendor whose entire job is "the page lands."
  ([GCP notification options][gcp-notif])
- **Phase 3 is one-to-two-person on-call.** PagerDuty Free's
  "5 users, 1 escalation policy" cap is exactly sufficient. The
  feature limits we'd hit in 2-3 years (response automation,
  unlimited escalation policies, custom event rules) are not
  Phase 3 problems.
- **Better Stack on-call** is interesting because we're already
  recommending Better Stack for the status page (§ 3 below), and
  the unified vendor would simplify ops. But their on-call
  product is on a paid plan and the migration friction from
  PagerDuty later is low. Defer.

### Cost impact

- **v1: $0/month.** PagerDuty Free.
- **Trigger to upgrade:** any one of:
  - On-call rotation grows past 5 humans.
  - A single month exceeds 100 SMS+phone notifications (which
    would mean we're paging too often — fix the alerting first,
    not the bill).
  - We need response automation (auto-Slack-incident, auto-Zoom-
    bridge) or > 1 escalation policy.
- At that point, Professional ($21/user/month as of 2026-05) is
  the next step. With 3 on-call rotators that's $63/month — a
  decision deferred to whenever it materializes.

### Reversibility

**Medium.** Switching paging vendors means: change
`infra/oncall/*.tf`, swap the Cloud Monitoring webhook URL,
republish the on-call's contact info, retrain reflexes. The
data plane is just "a webhook fires; a phone rings." No data
migration. Estimated cost: one afternoon per switch, so don't
treat this as a hard one-way door.

---

## 3. T59 — Status page vendor

### Question

Which vendor (or self-host) provides the public uptime/status
page promised by T59 acceptance criterion #3 (`status.jacob.app`)?

### Options considered

| Option | Free tier? | Custom domain on free? | Notes |
|--------|-----------|--------------------------|-------|
| Atlassian Statuspage | **No** — free tier discontinued; cheapest is paid | n/a | The historical default; not viable on the money constraint |
| Better Stack Status (Better Uptime) | **Yes** — 1 status page, 10 monitors, basic incident mgmt, custom domain | **Yes — included on free tier** | Most generous of the hosted free tiers |
| Instatus | **Yes** — 15 monitors, unlimited subscribers and teammates | Yes | Solid alternative; less integrated |
| Statuspal | **No longer free** — minimum $46/mo | n/a | Out for v1 |
| Self-hosted (cstate, Statusfy) | $0 vendor cost; hosting cost trivial on Firebase Hosting | Yes — your domain | Static-site generator; uses git for incident history |
| Custom: Firebase Hosting + Cloud Function pulling Cloud Monitoring uptime check state | $0 within free tiers | Yes | Most JACOB-shaped, but real implementation work |

### Recommendation

**Better Stack Status, free tier**, mapped to `status.jacob.app`.
Replace the `infra/status-page.tf` "Uptime Kuma vs StatusPage.io"
choice in T59 with a documentation-only setup (Better Stack is
hosted; no terraform resources for the page itself). Keep the
uptime checks in Cloud Monitoring (T15) as the source of truth
and either (a) point Better Stack monitors at the same public
endpoints, or (b) push incident state via their API from a small
Cloud Function fed by Cloud Monitoring webhooks.

### Why

- **Free tier is genuinely usable for our scale.** 1 status page,
  10 monitors, custom domain on `status.jacob.app`, dark mode,
  custom branding, basic incident management. We have far fewer
  than 10 user-facing endpoints worth showing. ([Better Stack
  status page][bs-status])
- **Atlassian Statuspage's free tier is gone.** Anything that
  was "default Statuspage and call it done" is now a $99+/month
  decision. Not happening pre-revenue.
- **Self-hosted Uptime Kuma is appealing but adds an SPOF.**
  The whole point of a status page is that *it stays up when
  the rest of your infra goes down.* Self-hosting on Cloud Run
  or Compute Engine puts the status page in the same blast
  radius as the thing whose status you're reporting. Vendor-
  hosted dodges that.
- **Static-site (cstate) self-hosted on Firebase Hosting** is a
  reasonable fallback if Better Stack goes paid-only later or
  has an outage of its own. The migration cost is "publish the
  same incident list as static markdown." Cheap exit ramp.
- **Instatus** is the second-best free option and would be a
  swap-in if Better Stack pricing changes.

### Cost impact

- **v1: $0/month.** Better Stack free tier covers the use case.
- **Trigger to upgrade:** any one of:
  - We need email or SMS subscribers > whatever their free cap
    is at upgrade-decision time (re-verify; pricing drifts).
  - We add private/audience-segmented status pages (e.g., per-
    org status visible only to that org's admins).
  - We want SLA history charts beyond the free retention window.
- Realistically MAU > 10k or paying-customer SLA contracts.
  Better Stack's paid plan starts around $30/mo (verify at
  upgrade time).

### Reversibility

**High.** Status pages contain very little stateful data the
user sees. Incident history can be re-imported (their export is
JSON). Custom-domain DNS swap is a CNAME change. If we ever
need to leave Better Stack we can (a) flip DNS to a static
Firebase-Hosting page in an hour, or (b) move to Instatus with
a one-day migration.

---

## 4. T63 — NCMEC submission protocol (SOAP vs HTTPS-XML)

### Question

NCMEC's CyberTipline ESP reporting API: do we implement against
the SOAP endpoint or the HTTPS+XML REST endpoint?

### Options considered

| Option | Status with NCMEC | Implementation cost |
|--------|------------------|--------------------|
| HTTPS REST + XML (`https://report.cybertip.org/ispws/`) | **Current, documented, recommended** | Standard `httpx` + `lxml` (or pydantic-XML) |
| SOAP | **Not documented in the current technical guide** as of 2026-05 | Higher: would need `zeep` or hand-built envelopes |

### Recommendation

**HTTPS REST + XML, full stop.** The spec's existing default
(`backend/app/services/ncmec.py` using the `https://report.cybertip.org/ispws/`
endpoint) is correct. Remove the "SOAP vs HTTPS-XML" framing
from the open-questions list — it isn't actually open.

### Why

- **NCMEC's own technical documentation describes the API as
  RESTful and XML-based**, not SOAP. The endpoints — `GET /status`,
  `GET /xsd`, `POST /submit`, `POST /upload`, `POST /fileinfo`,
  `POST /finish`, `POST /retract` — are HTTP verbs over HTTPS
  with XML bodies, authenticated via HTTP Basic with credentials
  issued during ESP registration.
  ([NCMEC CyberTipline API docs][ncmec-docs])
- The SOAP-vs-XML framing in spec § 6 #4 reflects historical
  uncertainty. The current docs make no mention of SOAP — neither
  as supported nor as deprecated. Treating SOAP as a serious
  option in 2026 means writing extra code for an endpoint that
  the operator docs don't acknowledge exists.
- The XML schema is published at `GET /xsd`. We pin the schema
  version in `backend/app/services/ncmec.py` and validate
  outgoing payloads at build time, not at submission time, so
  a schema regression caught in CI rather than during a
  fail-closed CSAM event.
- Reference implementations (e.g., the `ello/ncmec_reporting`
  Ruby gem and Hive's NCMEC integration docs) all target the
  REST/XML endpoint. We're not breaking new ground.
  ([Ello ncmec_reporting][ello-gh], [Hive NCMEC docs][hive-ncmec])
- **Operational note (not a code decision but worth recording):**
  before any production submission, ESP registration must be
  completed with NCMEC at `https://esp.ncmec.org/registration`
  to receive credentials. Sandbox creds use
  `https://exttest.cybertip.org/ispws/`. Both are required envs
  in T63 already (`NCMEC_ENDPOINT`); confirm both URLs are
  documented in `docs/legal/ncmec.md` when T63 lands.

### Cost impact

- **$0** — NCMEC reporting is free for ESPs. The cost is
  engineering + legal review, both of which we're paying
  anyway.

### Reversibility

**N/A** — there is no other supported protocol. If NCMEC ever
adds a gRPC or JSON-REST endpoint, migration is bounded to
`backend/app/services/ncmec.py`. Everything outside that file
(case state machine, operator UI, evidence retention) is
protocol-agnostic.

---

## 5. T55 — Vanity-domain serving (Cloud Run domain mappings vs External HTTPS Load Balancer)

### Question

For per-org custom domains (`our-church.jacob.app` and
operator-DNS vanity domains like `groups.our-church.org`), do
we use Cloud Run's built-in domain mapping, or stand up an
External HTTPS Load Balancer that fronts Cloud Run?

### Options considered

| Option | Cost | TLS | Ops | Notes |
|--------|------|-----|-----|-------|
| Cloud Run domain mapping (`gcloud run domain-mappings`) | $0 mapping cost | Google-managed cert auto-issued, ~15 min provisioning, up to 24h tail | Lowest | **GCP currently classifies domain mappings as "preview" and warns against production use due to latency.** Limited to 64 char domains. No own-cert support. |
| Firebase Hosting custom domain (frontend) + Firebase App Hosting backend | $0 within Firebase free tier | Auto, fast | Low | Works for the **Next.js frontend**, not Cloud Run directly. Aligns with T36's PWA approach. |
| External HTTPS LB + serverless NEG → Cloud Run | **~$18/mo per LB** (5 forwarding rules @ $0.025/hr ≈ $18) plus per-GB egress | Google-managed certs at LB level; supports own-cert | Medium: LB config, NEG, cert manager | Production-hardened. Required for advanced routing, Cloud CDN, Cloud Armor. |
| Cloudflare in front of Cloud Run | $0 on Cloudflare Free | Cloudflare-managed | Medium | Adds a third party to the request path; SaaS multi-tenant TLS at scale is a Cloudflare strength |

### Recommendation

**Two-tier approach, both cheap, one cutoff:**

1. **For `*.jacob.app` subdomains (the common case):** use
   **Firebase Hosting wildcard custom domain** for the frontend
   (Next.js) and let the existing API route through whatever the
   backend's hosting story is. This is the "Cloud Run domain
   mapping vs Firebase Hosting" axis the spec didn't explicitly
   ask, and Firebase Hosting wins on free + production-grade.
2. **For operator-DNS vanity domains (`groups.our-church.org`):**
   start with **Cloud Run domain mappings**, fully aware of the
   "preview" caveat. Document the latency risk in
   `docs/runbooks/custom-domains.md`. The number of vanity
   domains for v1 is bounded to "pilot churches that asked" — a
   handful, not a long tail. Switch to External HTTPS LB the
   moment we (a) need Cloud Armor for a vanity-domain DDoS
   incident, (b) need own-cert upload for an org with a hard
   cert-pinning requirement, or (c) the latency from domain
   mappings shows up in Cloud Monitoring as a real user
   complaint.

### Why

- **Cost.** External HTTPS LB is "always-on $18/month even with
  zero traffic." That fails the "no spending real money" rule
  for a feature whose Phase 3 user base is "the pilot churches."
  ([GCP load balancing pricing][gcp-lb-pricing])
- **Cloud Run domain mappings are free, work, and provision
  Google-managed certs automatically** — but Google explicitly
  flags them as "preview, not production-ready due to latency."
  That warning is real and we shouldn't ignore it for a feature
  the user notices (page-load on the org's landing page).
  ([Cloud Run custom domains][gcp-cr-domains])
- **Firebase Hosting wildcards** sidestep both problems. Wildcard
  domain support is a documented production feature, the cert
  story is solved, and the egress is on Firebase's CDN. Most of
  the Phase 3 vanity-domain story is "the org wants their logo
  and URL," which is a frontend concern.
- **Operator-DNS vanity domains** (`groups.our-church.org`) are
  the genuinely hard case because the org owns DNS and we have
  to validate ownership (TXT record — already in spec) and serve
  TLS for a domain we don't control. Cloud Run domain mappings
  *do* support this and the cert provisioning works; the
  preview-status latency caveat is the only real wart. For a
  pilot-church-count number of domains, accept the wart and
  document the upgrade path.
- **Cloudflare in front** is a viable Plan C. Their multi-tenant
  TLS via SaaS is mature. Adding a third party to the request
  path is a real cost (auth cookies, observability, on-call
  surface area), so don't pull it in without a forcing function.

### Cost impact

- **v1: $0/month.** Both Firebase Hosting (wildcard subdomains)
  and Cloud Run domain mappings (vanity domains) are free.
- **Trigger to upgrade to External HTTPS LB:**
  - Cloud Monitoring shows p95 latency on vanity-domain requests
    > 500ms for one week, OR
  - We get our first vanity-domain DDoS / scraping incident
    that needs Cloud Armor, OR
  - A church partner requires uploading their own cert.
- At that point, single LB at ~$18/mo serving all vanity
  domains via host-header routing is the natural next step.
  Three-figure-monthly is realistic.

### Reversibility

**High.** The data plane (Cloud Run service) doesn't change.
The frontend `middleware.ts` host-header parsing logic doesn't
care whether the request came in via Firebase Hosting, Cloud
Run domain mapping, an External HTTPS LB, or Cloudflare.
Switching is a Terraform + DNS change. Migration window: a
day, including TLS re-provisioning.

### Spec amendments this implies

T55 § "Files to create" should be updated to:

- Remove `infra/cloudfront.tf` (no AWS in our stack).
- Replace with `infra/firebase-hosting-domains.tf` (wildcard
  config) AND `infra/cloud-run-domain-mappings.tf` (per-vanity
  domain mapping).
- Keep `infra/firebase-app-hosting.yaml` for the frontend.

These are doc-only updates — no code changes — and can be done
when T55 is actually picked up.

---

## 6. T47 — Prayer cluster epsilon (DBSCAN cosine distance threshold)

### Question

What is the right value for `prayer_clustering_eps` (DBSCAN
cosine-distance threshold for clustering similar prayer
requests), and should it be a fixed value, leader-tunable, or
learned from feedback?

### Options considered

| Option | Risk profile | Operability |
|--------|-------------|-------------|
| Fixed at 0.25 (current spec default) | Conservative — fewer false-merges, more singletons | Easy: one number in `config.py` |
| Fixed at a higher value (0.30–0.40) | More merging; risk of theological-soundness false positives | Same |
| Leader-tunable per pilot | Calibrates to the pilot leader's intuition; hard to debug across pilots | Adds a UI + a feature flag |
| Per-org tunable, hidden from leaders | Platform admin sets per org based on observed quality | Backend setting; no UI surface |
| Learned from leader-feedback signal | Most adaptive; long horizon | Requires labeled data; nothing in v1 |

### Recommendation

**Ship with `prayer_clustering_eps = 0.18` (overriding the spec
default of 0.25), gated by P13 feature flag, with the value
exposed as an env-overridable config and a *platform-admin-only*
override per org (no leader-facing UI in v1).** Ship the
leader-tunable surface in v1.5 only if the pilot review signals
need.

The lower starting epsilon (0.18) reflects the theology-first
risk posture of the spec — false merges are catastrophic, false
splits are merely missed connections. We bias toward the
recoverable failure mode.

### Why

- **DBSCAN with cosine distance on sentence embeddings has a
  workable range of roughly 0.2–0.7** in published guidance, with
  the *correct* value heavily dependent on (a) the embedding
  model, (b) the typical document length, and (c) the desired
  cluster granularity. Prayer requests are short (1–3 sentences)
  and theologically distinguished by very fine-grained cues
  ("grief over loss" vs. "discernment in grief"), so we land at
  the **low end** of that range. ([DBSCAN epsilon for embeddings][dbscan-blog])
- **The asymmetric harm matters more than the math.** A
  false merge clusters "joy at a birth" with "grief over a
  death" and exposes that misclassification to a pilot leader
  in a digest. That damages the pilot leader's trust in the
  whole feature on a single bad sample. A false split shows two
  related requests as separate items in the digest, which is
  cosmetically annoying but causes no actual harm. We should
  pick a threshold that errs toward false splits.
- **0.25 is "common default" territory but isn't theologically
  justified.** 0.18 is tighter — closer to the conservative
  end of the cited 0.2–0.7 range — and matches the spec's own
  "every cluster passes the theological-soundness checklist"
  acceptance criterion better than 0.25 does.
- **Leader-tunable is the wrong axis to expose first.** A pilot
  leader who tunes a knob labeled "DBSCAN epsilon" will tune it
  poorly. If they tune a knob labeled "Group similar prayers
  more aggressively / more conservatively," they'll still tune
  it poorly because the right answer depends on the embedding
  model, not on their pastoral judgment. Better to keep the
  knob behind the platform-admin curtain in v1, gather the
  pilot leader's *qualitative* feedback (the
  theological-soundness checklist), and bring leader-facing
  tunability back as a question for v1.5 if the signal warrants.
- **Per-org override matters now, even without UI.** Different
  orgs have different prayer styles (high-church reserved
  language vs. evangelical-vernacular); a single global eps
  may underserve one of them. The escape hatch is a
  `orgs/{orgId}.prayerClusteringEps: number | null` field
  written by platform admin only, with the global default
  applying when null. This is a one-field add to the data
  model.
- **No learned epsilon in v1.** Learning requires labeled data,
  feedback loops, and an evaluation harness. The pilot review
  step in T47's acceptance criteria is the human substitute.

### Cost impact

- **$0** — config + one extra Firestore field. Zero new
  external services.

### Reversibility

**Trivial.** It's literally a number. The platform-admin
override path means individual orgs can be tuned without a
deploy. If 0.18 over-splits, raise it; if it false-merges, lower
it. The eval harness from `docs/runbooks/prayer-clustering-tuning.md`
is the place to test new values before promoting.

### Spec amendments this implies

- T47 § "Files to modify" → `backend/app/config.py`:
  change default from `prayer_clustering_eps: float = 0.25`
  to `prayer_clustering_eps: float = 0.18`.
- T47 § "Data model changes" → add
  `orgs/{orgId}.prayerClusteringEps: number | null` (default
  null; platform-admin-only write).
- T47 § "Firestore rule deltas" → extend `orgs` update branch
  to deny client writes to `prayerClusteringEps`.
- T47 § "Acceptance criteria" → keep the pilot-leader
  signoff; the lower default raises the prior probability that
  the pilot's first sample passes the checklist.
- ADR 0006 should record:
  1. Why we chose 0.18 over 0.25 (asymmetric harm, low end of
     cited range, prayer-request length).
  2. The decision *not* to expose tunability to leaders in v1.
  3. The escape hatch (per-org override via platform admin).
  4. The condition under which we'd revisit (pilot leader
     reports too many singleton clusters across two consecutive
     weekly digests).

---

## Summary of recommendations

| # | Item | Recommendation | v1 cost | Reversibility |
|---|------|---------------|---------|---------------|
| 1 | T57 LiveKit hosting | LiveKit Cloud, Build (free) tier; 4,000-min global cap to stay under 5,000 free | $0/mo | High |
| 2 | T59 paging | PagerDuty Free; drop Opsgenie | $0/mo | Medium |
| 3 | T59 status page | Better Stack Status, free tier, on `status.jacob.app` | $0/mo | High |
| 4 | T63 NCMEC protocol | HTTPS REST + XML at `report.cybertip.org/ispws/`; SOAP isn't actually offered | $0 | N/A |
| 5 | T55 vanity-domain serving | Firebase Hosting wildcard for `*.jacob.app`; Cloud Run domain mappings for vanity domains; upgrade to External HTTPS LB only on a forcing function | $0/mo | High |
| 6 | T47 prayer epsilon | Fixed at 0.18 (down from 0.25), platform-admin override per org, no leader UI in v1 | $0 | Trivial |

All six recommendations preserve the "no real money spent" rule
while keeping the upgrade ramp documented. None of them is a
hard one-way door.

---

## Open follow-ups

These came up while researching the six above and don't block
implementation but should be tracked:

1. **Phase 3 voice cost cap test** (T57) — the existing test only
   covers per-org cap; add a global-cap test once the
   `LIVEKIT_GLOBAL_MONTHLY_CAP_MINUTES` env is added.
2. **Prayer-clustering eval harness** (T47) — `docs/runbooks/
   prayer-clustering-tuning.md` should include 10–20 hand-labeled
   pairs marked "should-merge" / "should-split" so future eps
   tweaks can be regression-tested before deploy.
3. **NCMEC sandbox creds** (T63) — confirm with legal before T63
   work starts whether ESP registration is in flight; the
   sandbox creds (`exttest.cybertip.org`) require completed
   registration.
4. **Better Stack monitor parity** (T59) — decide whether status-
   page monitors duplicate Cloud Monitoring uptime checks (Better
   Stack pings the same endpoints) or are driven by a webhook
   from Cloud Monitoring incident state. Slight preference for
   the second to keep one source of truth.
5. **Firebase Hosting + App Hosting compatibility** (T55) — the
   spec assumes wildcard support on App Hosting; confirm before
   T55 implementation that wildcard subdomains route correctly
   to the Next.js app on App Hosting (vs. classic Firebase
   Hosting). If they don't, fall back to Cloud Run domain
   mappings for `*.jacob.app` too.

---

## Sources

- [LiveKit Cloud quotas and limits][lk-quotas]
- [LiveKit pricing page][lk-pricing]
- [PagerDuty Free plan 2026][pd-free]
- [Opsgenie Free plan 2026][og-free]
- [Opsgenie end-of-sale notice][og-eol]
- [GCP Cloud Monitoring notification options][gcp-notif]
- [Better Stack free status page][bs-status]
- [NCMEC CyberTipline Reporting API documentation][ncmec-docs]
- [Hive NCMEC integration docs][hive-ncmec]
- [`ello/ncmec_reporting` reference implementation][ello-gh]
- [Cloud Run custom domain mapping docs][gcp-cr-domains]
- [GCP Cloud Load Balancing pricing][gcp-lb-pricing]
- [DBSCAN epsilon for sentence embeddings — Towards Data Science][dbscan-blog]

Pricing and free-tier limits cited above are accurate as of
**2026-05-03** and should be re-verified before any task lands
that depends on them.

[lk-quotas]: https://docs.livekit.io/deploy/admin/quotas-and-limits/
[lk-pricing]: https://livekit.com/pricing
[pd-free]: https://pagerdutypricing.com/free-plan
[og-free]: https://www.atlassian.com/software/opsgenie/pricing
[og-eol]: https://www.atlassian.com/software/opsgenie/pricing
[gcp-notif]: https://docs.cloud.google.com/monitoring/support/notification-options
[bs-status]: https://betterstack.com/status-page
[ncmec-docs]: https://report.cybertip.org/ispws/documentation
[hive-ncmec]: https://docs.thehive.ai/docs/report-to-ncmec
[ello-gh]: https://github.com/ello/ncmec_reporting
[gcp-cr-domains]: https://docs.cloud.google.com/run/docs/mapping-custom-domains
[gcp-lb-pricing]: https://cloud.google.com/load-balancing/pricing
[dbscan-blog]: https://towardsdatascience.com/clustering-sentence-embeddings-to-identify-intents-in-short-text-48d22d3bf02e/

*End of Phase 3 design-decision recommendations.*
