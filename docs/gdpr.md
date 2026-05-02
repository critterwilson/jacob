# GDPR — outstanding work

This file tracks GDPR-adjacent obligations that are **not yet implemented**.
Update / remove entries as they ship.

## Data export (right of access — GDPR Art. 15)

**Status:** not implemented.

T14 (account deletion + grace period) shipped the deletion side of the
right-to-erasure flow. The complementary **data export** is its own task
and was deliberately deferred. If we need to support EU users at launch,
build it before going live in the EU.

Sketch of the work:

- `POST /api/account/export` enqueues a job
- Cloud Run job collects: `users/{uid}`, `users/{uid}/private/profile`,
  authored messages across all groups (collection-group query), and
  uploaded media object names.
- Result delivered as a signed-URL download (7-day TTL) emailed to the
  account email.
- Audit log entry per export request.

## Cross-references

- Account deletion: `backend/app/services/deletion.py`,
  `infra/scheduled/finalize_deletions.py`
- Audit log: `backend/app/services/audit.py`
