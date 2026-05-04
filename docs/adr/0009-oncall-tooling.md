# ADR 0009 — On-call tooling (paging, status page)

**Status:** Accepted (2026-05-04)
**Authors:** T59 implementation pass
**Resolves:** DESIGN-OPEN items 2 and 3 from
`docs/phase-3-design-decisions.md` (PR #103).

## Context

T59 operationalises on-call: rotation, escalation, an incident
playbook, a postmortem template, an in-app banner, a public status
page, and external paging. The `docs/phase-3-design-decisions.md`
companion doc landed recommendations on three vendor decisions
contingent on a hard "no paid services in v1" constraint:

* paging vendor (PagerDuty Free vs. Opsgenie),
* status-page vendor (Better Stack Status vs. Atlassian
  Statuspage),
* whether to self-host any of it.

This ADR pins the implementation-level decisions that follow.

## Decision

### Paging — PagerDuty Free

* 5 users / 100 phone+SMS minutes per month / unlimited push,
  unlimited integrations. **No credit card.**
* Sole 24/7 paging path that meets the SEV1 "phone rings even when
  the on-call is asleep" requirement under our budget.
* Opsgenie Free was rejected: no voice on the free tier, and
  Atlassian announced Opsgenie EOL on 2027-04-05 — adopting it now
  would force a migration mid-Phase-3.

### Status page — Better Stack Status free tier

* Free tier supports a custom domain on `status.jacob.app`,
  email subscribers, and the 5 components we need (web, API,
  push, search, moderation).
* Atlassian Statuspage no longer offers a free tier (their
  starter plan is $29/mo per status page). Out of scope.
* Uptime Kuma was considered for self-host; rejected because it
  needs its own VM ($5–10/mo at minimum), and the operator burden
  on the on-call is exactly what we're trying to reduce.

### In-app banner — built into the platform, not a vendor

The banner is the highest-leverage status surface (every authed
user sees it at the top of every page). It lives in
`active_incidents/{incidentId}` Firestore docs, written via
`/api/admin/incidents` — see the implementation in
`backend/app/routers/incidents.py`. Vendor-hosted status pages
serve users who can't sign in; the in-app banner serves the
common case.

### Postmortem cadence — 5 business days

SEV1 / SEV2 only. SEV3 stays in the issue tracker. Template lives
at `docs/postmortem-template.md`. Postmortems file at
`docs/postmortems/<YYYY-MM-DD>-<slug>.md`.

### Rotation — two-person, weekly handoff

Documented in `docs/oncall.md`. Primary acks; backup is hot-standby.
The on-call handoff is a 15-minute Tuesday-morning sync (when there
*is* a second on-call person; while the team is one human, this
ADR documents the path the second hire follows).

## Why these defaults

1. **$0/mo for v1.** Both vendors cited above are genuinely free
   under the constraint with no credit card on file.
2. **Reversibility.** PagerDuty + Better Stack both support data
   export. Switching to a paid Opsgenie or Atlassian plan is a
   billing change, not a re-platform.
3. **Paging tool the on-call actually carries.** PagerDuty has a
   solid mobile app + reliable voice call. The on-call carrying
   their phone matters more than feature breadth.
4. **The in-app banner is the system-of-record for active
   user-visible state.** External status pages are
   defense-in-depth for the cases where users can't sign in.

## What we explicitly did NOT do

* Adopt a chaos-engineering tool. Phase 4 problem; premature for
  current scale.
* Wire automated incident-channel creation in Slack. Manual is
  fine at the current incident rate (~zero per month).
* Stand up a dedicated `#noisy-alerts` channel. SEV3 and below go
  to the issue tracker; we don't need a channel for them.
* Provision the actual PagerDuty / Better Stack accounts in this
  PR. Operator step; documented in `docs/runbooks/incident.md`.
* Auto-publish the in-app banner to the status page. The banner
  and the status page are intentionally independent surfaces — an
  internal-only banner for a SEV3 shouldn't leak to the public
  status page.

## Cost trigger to revisit

* PagerDuty: rotation grows past 5 humans, OR voice-minute usage
  hits the 100/month free cap. Both are good problems to have.
* Better Stack: subscriber count exceeds free tier (currently
  150 email subscribers).

## Cross-references

* Implementation: `backend/app/routers/incidents.py`,
  `frontend/components/IncidentBanner.tsx`,
  `frontend/lib/hooks/useActiveIncidents.ts`.
* Operational docs: `docs/oncall.md`,
  `docs/runbooks/incident.md`, `docs/postmortem-template.md`.
* Companion design-decisions doc:
  `docs/phase-3-design-decisions.md` § 2 + § 3.
