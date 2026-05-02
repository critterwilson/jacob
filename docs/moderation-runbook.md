# Moderation runbook

## In-app reporting (T19)

Reports are filed natively in JACOB and land in `moderation_queue/{itemId}` in
Firestore. The Google Form integration that shipped with T12 has been retired.

### How the flow works

1. A signed-in user clicks the Report icon on a message, group, or profile.
2. `ReportDialog` opens with a structured form: a required reason
   (`harassment | sexual | violence | self-harm | spam | other`) plus an
   optional 500-char context box.
3. The dialog calls `POST /api/reports`. The backend:
   - Verifies the Firebase ID token (401 if missing/invalid).
   - Rejects active-ban reporters with 403.
   - Computes a `severity` (1–3) from the reason.
   - Dedupes against an existing `(reporterUid, resourceRef, reason)` triple in
     the past 24h. A duplicate returns `dedup: true` with the existing report
     id — no second `moderation_queue` doc is written.
   - Otherwise writes `moderation_queue/{uuid}` with `status: "pending"`.
4. Moderators triage at `/admin/queue` (admin-only).

### Severity table

| Reason       | Severity |
|--------------|----------|
| `sexual`     | 3        |
| `self-harm`  | 3        |
| `violence`   | 3        |
| `harassment` | 2        |
| `spam`       | 1        |
| `other`      | 1        |

T20 (automated text moderation) writes additional rows with `auto: true` and
its own severity. Severity is independent from `status` and is used only to
sort/filter in the queue UI.

## Triage process

Moderators check the queue at `/admin/queue` daily. Filters: status
(pending / approved / rejected) and reason. Default sort is oldest-first;
sort by severity to triage high-risk items first.

Suggested SLA:

| Severity | Target response |
|----------|-----------------|
| 3        | Within 1 hour (escalate immediately — see below) |
| 2        | Within 4 hours  |
| 1        | Within 48 hours |

### Reviewing one item

1. Open `/admin/queue?status=pending`.
2. Click the resource link to inspect the message / group / profile.
3. Decide:
   - **Approve** — content is fine; mark resolved with `status: "approved"`.
   - **Reject** — content violates policy; mark resolved with `status:
     "rejected"`. The author is notified via email (T18).
   - **Reject + Ban** — same as reject, plus a 24h / 7d / permanent ban for
     the content's uploader.
4. Every action writes an `audit_log` entry.

### Bulk actions

Selecting multiple rows and clicking *Reject all* / *Approve all* writes one
audit entry per resolved row. *Reject + Ban reporters* is meant for false-
report clusters (one reporter spamming reports across many resources): it
rejects all selected rows and 24h-bans the unique reporters of those rows.

### Shareable URLs

Filter state lives in the URL query string, e.g.
`/admin/queue?status=pending&reason=sexual&sortBy=severity`. Paste the URL into
Slack to point another moderator at the same view.

## Escalation

- **CSAM suspicion:** report to NCMEC (CyberTipline) and disable the account
  immediately. Do not investigate further yourself.
- **Credible threats of violence:** contact local law enforcement if you know
  the reporter's location; otherwise escalate to the platform owner.
- **Platform owner contact:** christopherwilsontry@gmail.com

## Reporter privacy

Reporter UIDs are only exposed to admins viewing the queue. They are never
shown to the reported user. Anonymous reporting is not supported in T19 — a
reporter must be signed in. Phase 3 will surface a "your report was reviewed"
status to the reporter.

## Kill switch

If the reports endpoint becomes a vector for abuse (a botnet flooding
`moderation_queue`), tighten `REPORT_SUBMIT` in `backend/app/limits.py` and
redeploy. The rate-limit decorator is per-uid; the slowapi in-memory store
resets on instance restart but the rate floor is short enough that a Cloud
Run cold start does not buy meaningful additional capacity.
