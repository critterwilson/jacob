# CSAM incident runbook (T63)

## Severity

A confirmed CSAM hash match is **always** SEV1 even if no user is
visibly affected — the legal reporting clock starts at the moment
of detection.

## When the page fires

The on-call admin's phone rings (PagerDuty SEV1) and Sentry shows
a `csam_match_detected` event. The case lands in
`/admin/ncmec` queued as `pending`.

## First 15 minutes

1. **Acknowledge.** PagerDuty + the in-app banner via `/admin/incidents`.
2. **Open the case** at `/admin/ncmec`. Confirm the
   `evidence.gcsPath` is a real path under `_held/` and the
   `sha256` matches the recorded hash.
3. **Do NOT view the file.** Verifying the match means trusting
   the hash, not opening the image. The pipeline already moved it
   to `_held/`; no admin needs to re-confirm by viewing.
4. **Contact counsel immediately** for the first real fire. Their
   playbook is at `docs/legal/ncmec.md`.

## During the incident

* The held file stays in `_held/<sha256>` with `retainedUntil`
  set 90 days out. Lifecycle won't delete it before that.
* No user-visible action is required (the upload was blocked at
  finalize time).
* If counsel says proceed: click **Submit** on the case in
  `/admin/ncmec` and type `SUBMIT` to confirm. The backend
  records the operator action.

## Manual NCMEC submission (until the HTTPS integration lands)

The Submit endpoint in v1 records the operator's intent + a
synthetic `STUB-<random>` report id. **The actual NCMEC
CyberTipline submission is manual.** Steps:

1. Log in to the NCMEC reporting portal at
   <https://report.cybertip.org/>.
2. Open the existing operator account (credentials in Secret
   Manager → `ncmec-operator-creds`).
3. File a new report. Use the case-doc fields:
   * Hash source (PhotoDNA / PDQ / other)
   * Hash value
   * Evidence GCS path (NCMEC accepts a URL pointer + the file
     itself; upload from the held bucket)
   * Suspect uid (if known) + uploader IP if recorded
4. Once NCMEC acknowledges with their real report id, update the
   case doc directly: replace the `STUB-<id>` `ncmecReportId`
   with the real one.
5. Update the on-call thread + close the SEV1.

ADR 0010 documents the rationale for the stub-then-manual path
and the conditions under which we'd flip the integration on.

## False positives

Hash collisions are rare but real. If counsel determines a case
is a false positive:

1. Click **Withdraw** in `/admin/ncmec`.
2. Type a reason ≥ 50 characters (the form enforces this — it's
   what a future audit will read).
3. If the case was already submitted to NCMEC, also file a
   withdrawal report through the NCMEC portal.
4. The held file stays in `_held/` for the configured retention
   period; the bucket lifecycle deletes it on schedule.

## Postmortem

Every CSAM SEV1 produces a postmortem within 5 business days
using `docs/postmortem-template.md`. Include:

* Detection time
* Time to acknowledgement
* Submission time (or withdrawal time)
* Counsel sign-off on the conclusion
* Action items (e.g. update hash provider, tune match threshold)

## Cross-references

* `docs/legal/ncmec.md` — legal framework
* `docs/adr/0010-ncmec-reporting.md` — design rationale
* `backend/app/services/ncmec.py` — case lifecycle service
* `backend/app/routers/ncmec.py` — operator surface
