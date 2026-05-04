# ADR 0010 — NCMEC reporting workflow (T63)

**Status:** Accepted (2026-05-04)
**Authors:** T63 implementation pass
**Related:** `docs/legal/ncmec.md`, `docs/runbooks/csam-incident.md`,
`docs/phase-3-design-decisions.md` § 4 (NCMEC submission protocol).

## Context

T10 / T11 (Phase 1) detect CSAM hashes on photo upload and move
matching files to `_held/<sha256>` in the quarantine bucket. The
files don't go anywhere else; they accumulate.

T63 closes the loop: when a CSAM match fires, the system creates
a formal `ncmec_cases/{caseId}` doc, surfaces it in the platform-
admin queue, and on operator approval files an NCMEC CyberTipline
report.

## Decision

Three load-bearing choices:

### 1. Operator-gated, not auto-submit

Every case is `pending` until a platform admin clicks Submit + types
`SUBMIT` to confirm. We do NOT auto-submit on detection.

Why: false-positive escalation cost is too high for a small team.
A bad hash collision that auto-fires would still file a real legal
report against an innocent user. Operator-in-the-loop is the
defense-in-depth.

### 2. Fail-closed on submit

If the NCMEC API is unreachable on the operator-approved submit
path, the case **stays `pending`** until a successful submit lands.
We never silently mark a case as "submitted" without server
confirmation.

The submit endpoint never blocks the upload pipeline — that
already happened at T10 hash-match time. Fail-closed here applies
only to the reporting step.

### 3. v1 stubs the actual NCMEC HTTPS call

The CyberTipline accepts HTTPS POST + XML at
`https://report.cybertip.org/ispws/`. v1 of T63:

* Records the operator action (`status: submitted`,
  `submittedBy`, `submittedAt`, synthetic `STUB-<random>` report
  id).
* Logs `MANUAL_ACTION_REQUIRED` so the on-call sees that the
  HTTPS step is outstanding.
* The on-call files the report manually with NCMEC and replaces
  the stub report id with the real one.

Why stub:

* The NCMEC operator account isn't yet provisioned. The XML
  payload + retry semantics need counsel review before the
  integration goes live (one bad request is one bad legal
  filing).
* The runbook + queue + audit trail are the load-bearing pieces
  of T63's product surface. Wiring the HTTPS call is the
  integration follow-up that lands when the operator account is
  in place.

The decisions doc (PR #103) recommended HTTPS REST + XML at
`report.cybertip.org/ispws/`. SOAP isn't actually offered — that
DESIGN-OPEN dissolved on contact with the current operator docs.

## Withdrawal protocol

Withdraw requires a written reason ≥ 50 characters. If the case
was already submitted, the operator manually files a withdrawal
through the NCMEC portal (same stub pattern as submit until the
HTTPS integration lands). The case doc records both states.

## Retention

Default: 90 days from match. Counsel can extend per case. Bucket
lifecycle deletes only objects whose `retainedUntil` has passed.
T63's case doc stores `retainedUntil` so the lifecycle rule has
something to read.

## What v1 doesn't do

* Auto-submit any case
* Actually call the NCMEC HTTPS endpoint (stubbed; wiring is the
  follow-up)
* Auto-extend retention based on case status
* Photo-DNA-side hashing (we consume the existing T10 hash; the
  source provider is a separate decision)

## Cost trigger to revisit

* If the manual submission cadence exceeds ~1 case / week,
  prioritise the HTTPS integration (manual filing burns ~30 min
  of operator time per case at the current portal flow).
* If counsel revisits the retention window, update both the bucket
  lifecycle rule and the default in `services/ncmec.py`.

## Cross-references

* Implementation: `backend/app/services/ncmec.py`,
  `backend/app/routers/ncmec.py`,
  `frontend/app/admin/ncmec/page.tsx`.
* Operational: `docs/legal/ncmec.md`,
  `docs/runbooks/csam-incident.md`.
* Decisions companion: `docs/phase-3-design-decisions.md` § 4.
