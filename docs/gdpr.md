# GDPR — privacy obligations and runbooks

This document covers the user-data lifecycle: erasure (T14), self-serve
export (T38), and the manual privacy-rights triage path. Update entries
here as the surfaces change.

## Right to erasure (GDPR Art. 17) — *implemented (T14)*

Live flow:

- `POST /api/account/delete` enqueues a deletion with a 14-day grace window.
- `POST /api/account/delete/cancel` cancels within the window.
- `infra/scheduled/finalize_deletions.py` runs daily and hard-deletes
  past-grace accounts (disable Auth, tombstone messages, delete avatar,
  delete `users/{uid}/private/profile`, delete `users/{uid}`).
- `audit_log` retains a `system`/`account_finalized` row indefinitely.

Cross-references:
- `backend/app/services/deletion.py`
- `backend/app/routers/account.py`
- `infra/scheduled/finalize_deletions.py`

## Right of access (GDPR Art. 15) — *implemented (T38)*

Live flow:

- `POST /api/account/export` enqueues an export job in
  `users/{uid}/exports/{jobId}`. Backend audit-logs `export_request`.
- `infra/scheduled/process_export_jobs.py` polls every 5 minutes,
  assembles the bundle in `backend/app/services/export.py:assemble`,
  validates against `services/export_schema.py`, gzips, uploads to
  `gs://jacob-exports-{env}/{uid}/{jobId}.json.gz`, stamps the doc
  with a 7-day V4 signed URL, and emails the user.
- The bucket lifecycle deletes objects after **14 days** as a backstop.
- `GET /api/account/export/status` powers the in-app status UI.
- `GET /api/account/export/{jobId}/download` 302-redirects to the
  signed URL for the in-app "Download" button.

### Bundle scope (the contract)

In scope for the JSON bundle:

- Profile (`users/{uid}` + `users/{uid}/private/profile`).
- All messages authored by the user, across all groups, including
  soft-deleted (with tombstone status). `parentMessageId` preserved.
- All reactions added by the user (best-effort; bounded scan, see
  "Edge cases" below).
- All mentions of the user (`messages` where `mentions` array-contains
  uid).
- All `audit_log` entries with `actorUid == uid` OR
  `targetRef == users/{uid}`. Foreign uids/emails in payloads are
  redacted before bundling — see
  `backend/app/services/export.py:_sanitise_audit_payload`.
- Photo URLs uploaded by the user (URLs only, not bytes).
- Notification preferences and devices (FCM tokens are intentionally
  *not* included — see "Edge cases").
- Mute and block lists.
- Group memberships (gid + role).

Out of scope (covered by the manual rights path below):

- Other users' messages, even in groups the user is in.
- Group metadata beyond what the user produced.
- Moderation queue rows authored *about* the user (evidentiary).

### Edge cases / known constraints

- **Bundle size cap**: bundles > 1 GiB refuse with `bundle_too_large`
  and route to the manual rights path.
- **Reaction enumeration**: reactions are stored at
  `groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}`. There is
  no targeted query for "all reactions by user X". The assembler scans
  the `users` collection-group with a hard cap of 10,000 docs (see
  `_REACTION_SCAN_CAP`). For users on a database past that cap,
  reactions are best-effort.
- **FCM tokens**: the bundle redacts `fcmToken` fields on device docs
  — a leaked bundle holding a live push token is actively dangerous,
  and the user owns the device anyway.
- **Audit payload PII**: foreign uids and emails are stripped from
  bundled audit-log payloads. The user's *own* uid and email survive.
- **Soft-deleted and moderation-hidden messages**: included in the
  bundle, with their tombstone/hidden flags preserved.
- **Account deleted while export in flight**: the processor detects
  the missing user doc and writes `failureReason="account_deleted"`.
- **Signed URL leaks**: the URL is a credential. Email body warns the
  user. URL TTL is 7 days; bucket TTL is 14 days. Compromise window
  is bounded.

### Schema versioning

The bundle envelope carries `schemaVersion: 1`. Any breaking change
bumps this and adds a migration note here. Past versions remain valid
forever for users who still hold them.

## Right to rectification (GDPR Art. 16) — *user-driven*

Users can edit their own `displayName`, `photoURL`, and `isMinor` flag
via the standard profile UI. Other fields require the manual rights
path.

## CCPA right to delete

Covered by the same flow as GDPR Art. 17 above (T14). No separate
endpoint.

## Manual privacy-rights triage path

For requests that the automated paths don't satisfy (data about the
user held by moderation, evidentiary records, requests for content
authored *about* the user):

1. **Intake**: requests come in to `EMAIL_REPLY_TO` (the address in
   the backend `Settings`). Triage within 5 business days.
2. **Identity verification**: confirm the requester controls the
   account email via a signed-in confirmation link, or a notarized
   identity document if they no longer have account access.
3. **Decision**: privacy lead approves or refuses with reasons.
   Refusals for evidentiary content (CSAM, ban-evidence) are documented
   per the moderation runbook.
4. **Fulfillment SLA**: 30 days for GDPR DSAR (Art. 12(3)). Status
   updates to the requester at day 7, 14, 21.
5. **Audit**: every manual fulfillment writes an `audit_log` row with
   `action: "privacy_rights_manual_fulfillment"`,
   `actorUid: <responder>`, `targetRef: "users/{uid}"`, payload
   summarizing the categories returned.
6. **Escalation**: privacy lead unavailable → CTO → outside counsel.

## Cross-references

- Account deletion: `backend/app/services/deletion.py`,
  `infra/scheduled/finalize_deletions.py`
- Data export: `backend/app/services/export.py`,
  `backend/app/routers/account.py`,
  `infra/scheduled/process_export_jobs.py`,
  `infra/exports.tf`
- Audit log: `backend/app/services/audit.py`
- Bucket policy: `infra/exports.tf`, `infra/buckets.tf`
