# NCMEC reporting (T63) — legal framework

**This document is operational guidance, not legal advice.** Every
JACOB platform admin who can submit NCMEC reports needs to read it
once and re-confirm understanding annually. Counsel reviews this
document on the same cadence.

## Why we report

Federal law (18 U.S.C. § 2258A) requires "providers of electronic
communication services" to report apparent CSAM to the National
Center for Missing & Exploited Children's CyberTipline within a
"reasonable" window of becoming aware. Failure to report carries
significant fines per knowing-failure incident.

Our existing CSAM detection (T10 / T11 hash-match path) creates a
record of *every* match. T63 wires that record into a formal
CyberTipline submission flow.

## Who can submit

Only platform admins (`auth.token.admin == true`) can hit the
`/api/admin/ncmec/*` endpoints. The submit endpoint requires a
typed `SUBMIT` confirmation in the request body to defeat
accidental clicks.

The first real-world submission **must be reviewed with counsel**
before it fires. The runbook at `docs/runbooks/csam-incident.md`
walks the on-call through that path.

## Operator account ownership

The NCMEC operator account (the credentials used to authenticate
with the CyberTipline API) is owned by JACOB's incorporation
entity. The operator id + API key live in Secret Manager; rotation
is an annual responsibility tracked in the on-call doc.

## Chain of custody

Every CSAM-flagged upload moves to `_held/<sha256>` in the
quarantine bucket immediately at finalize time (existing T10
path). T63 ensures the file is **not deleted** before
`retainedUntil` passes:

* Default retention: 90 days from match (configurable per case).
* The bucket lifecycle rule deletes only objects whose
  `retainedUntil` has passed; until then the held file is
  immutable.
* The case doc records the file's GCS path + sha256 + size; the
  evidence is reproducible.

If counsel advises a longer retention for a specific case, the
operator updates `retainedUntil` on the case doc and Sentry
alerts on the next reaper sweep.

## Submission protocol (deferred to the integration follow-up)

The CyberTipline accepts HTTPS POST with an XML payload at
`https://report.cybertip.org/ispws/`. v1 of T63 ships the
operator queue + the case-doc lifecycle but **stubs the actual
HTTPS call** — when the operator clicks Submit, the backend
records `status: submitted` with a synthetic `STUB-<random>`
report id and logs a `MANUAL_ACTION_REQUIRED` line. The on-call
files the report manually with NCMEC until the integration
lands.

ADR 0010 documents the rationale (an operator account isn't yet
provisioned; the integration needs counsel review of the XML
payload + the failure-mode handling).

## Withdrawal (false positives)

Hash collisions happen — every CSAM hash provider has a non-zero
false-positive rate. The withdraw endpoint requires a written
reason (≥ 50 characters) so a future audit can reconstruct *why*
the operator decided the case wasn't reportable.

If the case was already submitted to NCMEC, the operator must
also file a withdrawal report manually with NCMEC. The runbook
has the exact wording.

## Audit trail

Every submit / withdraw writes an `audit_log` row keyed by the
case id. The original case doc is never deleted; lifecycle is
state changes only.

## Periodic review

Counsel reviews:
- This document
- The runbook at `docs/runbooks/csam-incident.md`
- The current `_held/` retention sweep
- A sample of last-quarter case docs (with PII redacted)

Cadence: every 12 months at minimum, plus any time the underlying
law changes.
