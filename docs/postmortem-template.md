# Postmortem template

Use one copy of this template per SEV1 / SEV2 incident. File it in
`docs/postmortems/<YYYY-MM-DD>-<slug>.md` within 5 business days of
the incident closing. Postmortems are **blameless** — the goal is to
make the system safer, not to assign individual fault.

---

## Title

[YYYY-MM-DD] One-line description of the user-visible impact.

## Severity

SEV1 / SEV2 (use SEV3 entries in the runbook log instead — those don't
warrant a full postmortem).

## Status

`open` while action items remain → `closed` when every item is shipped
or explicitly accepted-as-risk by the owner.

## Authors

Incident commander + everyone who responded. Writer is whoever closed
the incident.

## TL;DR

2–3 sentences. What broke, who saw it, how long, what fixed it.

## Impact

| Metric             | Value             |
|--------------------|-------------------|
| Detection time     | (alert → ack)     |
| Mitigation time    | (ack → fix)       |
| Total user impact  | (UTC start → UTC stop, affected users / orgs / surfaces) |
| Downstream effects | data loss? duplicates? wrong notifications? |

## Timeline

All times UTC.

* `HH:MM` — first signal (alert / Sentry / user report). Who acknowledged.
* `HH:MM` — diagnosis attempts. What was tried, what was ruled out.
* `HH:MM` — root cause identified.
* `HH:MM` — mitigation deployed.
* `HH:MM` — full recovery confirmed.

## Root cause

What actually happened. Cite specific commits, deploys, config
changes, or external dependencies. Be technical and exact.

## Contributing factors

Things that made the incident worse or harder to detect:

* Monitoring blind spots (we should have seen X earlier).
* Runbook gaps (the steps we needed weren't written down).
* Recent changes that increased fragility.
* Tooling friction (we couldn't roll back fast enough because…).

## What went well

Real things, not polite things. If the rollback took 30 seconds because
we had a one-command revert path, write that down — it's a system
property to preserve.

## What went poorly

Honest list. What slowed us down, what surprised us, what we wish we'd
known.

## Action items

| ID  | Owner   | Description                          | Due        | Status   |
|-----|---------|--------------------------------------|------------|----------|
| A1  | @owner  | Add Sentry alert on …                | 2026-MM-DD | open     |
| A2  | @owner  | Document the rollback step in oncall.md | 2026-MM-DD | open  |
| A3  | @owner  | Reduce blast radius by …             | 2026-MM-DD | open     |

Track these in the engineering tracker after the postmortem ships;
don't let the doc be the system of record for action items.

## Related

* Original alert / Sentry link
* Slack channel / on-call thread
* Commits that fixed the issue (with hashes)
* Related postmortems (if a previous incident touched the same surface)
