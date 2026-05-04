# Incident playbook (T59)

The on-call uses this when a SEV1/2 fires. SEV3s log a runbook entry
without a full incident process.

## Severity definitions

| Sev   | Definition                                                                  | Response time             | Page after-hours? |
|-------|-----------------------------------------------------------------------------|---------------------------|-------------------|
| SEV1  | Production outage. Multiple users can't sign in / send messages.            | Acknowledge ≤ 5 min       | Yes (24/7)        |
| SEV2  | Production degraded. A surface (search, push, moderation) is down or wrong. | Acknowledge ≤ 30 min      | Business hours    |
| SEV3  | Bug or paper cut affecting some users. No data loss, no auth break.         | Triage in next standup    | No (ticket)       |

If you're unsure, default *up* one level. Over-paging is recoverable;
under-paging means a real problem festers.

## Who's on call

See `docs/oncall.md` § "Rotation". Two-person rotation, weekly handoff.
Primary picks up the page; backup is hot-standby (no dedicated work,
ready to take over if primary doesn't acknowledge in the SLO window).

## Declaration

When you decide an incident is in progress:

1. **Acknowledge** the alert in PagerDuty (Free tier, see ADR 0009).
2. **Open the in-app banner**: `/admin/incidents` → declare
   (severity, title, body, displayMinutes). The banner is non-
   dismissible and appears at the top of every authed page.
3. **Open a Slack thread** in `#incidents` (create if it doesn't
   exist). Pin the thread to the channel for the duration. Drop the
   incident id from step 2 in the first message.
4. **Set status page** — flip the relevant component to
   `Investigating` on Better Stack Status (`status.jacob.app`).

You are now the incident commander (IC) until you hand off.

## Comms template (Slack)

Pin this in the thread:

```
🚨 SEV{1|2}: <one-line description>

Status: <Investigating | Identified | Mitigating | Monitoring | Resolved>
Impact: <surface, % users, started UTC>
Lead: @<your handle>
Banner: <copy of the in-app banner text>
Status page: <link>

— updates below this line —
```

Update the thread every 15 min while the incident is open, even with
"no change yet". Silence on the thread is interpreted as "fixed".

## Mitigation order of operations

1. **Roll back** if a deploy preceded the incident (see `oncall.md`
   § "Cloud Run / App Hosting" — `gcloud run services update-traffic`
   or `firebase apphosting:rollouts:delete`). Roll back FIRST and
   diagnose AFTER — if the bug is in the deploy, you've fixed the
   user impact.
2. **Flip a feature flag** if the affected surface is gated (T58).
   `python backend/scripts/flag.py disable <flag>`.
3. **Disable the abuse path** if the issue is user-driven
   (rate-limit dial, ban a uid, lock an org).
4. **Patch + deploy** is last resort; mitigations above buy you
   time to write the fix carefully.

## Resolution

When the user impact is gone:

1. Update the Slack thread: status → `Resolved`, with the actual fix.
2. Status page → `Resolved`.
3. **Clear the banner**: `/admin/incidents` → clear, OR let it
   auto-clear at `displayUntil` (declarations default to 60 minutes;
   bump if you need longer).
4. Schedule the postmortem (5 business days for SEV1/2). Use
   `docs/postmortem-template.md`.
5. Hand off back to the regular rotation.

## What NOT to do

* **Do not "force-push" mitigations** to production without code
  review unless the IC explicitly accepts the risk in the thread.
  Even SEV1s shouldn't ship blind.
* **Do not page-by-text-message** for SEV3s. Use the issue tracker.
* **Do not "no-comms" an incident**. Silent recovery looks like
  hiding it from users; even a 60-minute total-outage banner with
  one update is better than no banner at all.
* **Do not delete the active_incidents doc** to clear it. Use the
  clear endpoint — the audit trail matters for the postmortem.

## Drill cadence

Run a synthetic SEV1 once per quarter:

* Operator declares a fake incident in **staging** with the title
  prefixed `[DRILL]`. Walk every step of this runbook. Postmortem
  the drill itself.
* Real production incidents reset the drill clock — three months
  of live incidents means you don't need a synthetic drill that
  quarter.
