# Quarterly transparency report — runbook

The report is generated as a draft on the 1st of Jan / Apr / Jul / Oct
by `infra/scheduled/transparency_report.py`. A platform admin reviews
it before clicking **Publish**.

## Generate (or regenerate) a draft

```bash
cd backend
python ../infra/scheduled/transparency_report.py --scope platform
# default: previous quarter; default also generates a per-org draft
# for every org. Pass --skip-orgs to skip them.
```

To regenerate, delete the existing `transparency_reports/{id}` doc and
re-run; the script is idempotent on `(period, scope)`.

## Review checklist

Before clicking **Publish** (UI: `/admin/transparency`), confirm:

1. **Period label is correct.** Match the bucketed counts to the
   prior-quarter window (no off-by-one on the year boundary).
2. **All counts look reasonable.** Cross-check against Cloud Logging:
   - `audit action="ban_user"` count vs `moderationActions.accountsBanned`
   - `audit action="ncmec_submit"` count vs `ncmec.submitted`
   - `audit action="appeal_submit"` count vs `appeals.submitted`
   A delta > 10% suggests a bug — investigate before publishing.
3. **No PII anywhere.** Open the report JSON in DevTools and grep for
   `@`, `groups/`, `users/`, `messages/`, `appeals/`. Also test with the
   command:

   ```bash
   uv run python -c "
   import json, sys
   from app.services.transparency import payload_contains_pii
   data = json.load(sys.stdin)
   leak = payload_contains_pii(data['payload'])
   print('LEAK:' if leak else 'CLEAN:', leak or 'no identifiers')
   " < /tmp/draft.json
   ```

   The publish endpoint also runs this guard, but reviewing manually is
   the last human check.
4. **Org-scoped reports** must look right per-org. Spot-check at least
   one org's report and confirm the bucketed counts match what the org
   admin would see in their `/orgs/<orgId>/admin` group-health view
   (T60).
5. **No newly added bucket fields** that aren't documented in
   `backend/app/models/transparency.py`. Fields not in the model will
   silently drop on the next schema-version bump; add them to the model
   first.

If anything is off, do not publish. Fix, regenerate, re-review.

## Publish

In the admin UI: `/admin/transparency` → click the draft → **Publish**.
The endpoint records an audit row and flips the report to public at
`/transparency` and (per-org) `/orgs/{orgId}/transparency`.

## Audit-log CSV export

`/api/admin/transparency/audit-log.csv?days=N` — used internally and
during third-party audits. Default 90 days; max 730 days. The CSV opens
in Excel cleanly (RFC 4180 quoting via Python's `csv.writer` with the
`excel` dialect).

The CSV deliberately omits the `payload` column because some payloads
contain free-text reasoning (appeal decisions, NCMEC withdrawals).
Operators who need the payload should query Firestore directly with
their own access controls.

## Privacy contract

- The aggregator emits **integer counts only**. No uids, group ids,
  message ids, emails, or free-text fields ever land in the payload.
- The privacy guard (`payload_contains_pii`) is enforced at three
  points: `write_draft`, `publish`, and a unit test that asserts the
  generated payload from a poisoned-input fixture is clean.
- If a future field needs to expose more granularity, ADR it first.
  "By-org category breakdowns are okay because orgs don't identify
  members" — that's the kind of trade-off worth writing down before
  shipping it.
