# Feature flags runbook (T58)

## What this is

A self-serve feature-flag system. Every Phase 3 task ships behind a flag.
Flags live at `feature_flags/{flagKey}` in Firestore. The frontend reads
its evaluated `{flagKey: bool}` map from `GET /api/flags`; admins mutate
flags via `/api/admin/flags*` (or the CLI in `backend/scripts/flag.py`
during incidents).

## Naming convention

- **Lowercase snake_case**, 3–64 characters, must start with a letter.
- **Verb-object format**: `mobile_native_enabled`, `presence_enabled`,
  `devotionals_enabled`.
- **Use `_enabled` suffix** for on/off rollouts so the call sites read
  `if (useFlag('presence_enabled'))`.
- **Avoid negation** (`disable_x`, `no_y`) — flips your brain when reading
  call sites.
- **Prefix experiment flags with `exp_`** if you ever need to A/B
  (Phase 4 — out of scope for v1).

The validator in `backend/app/models/flags.py` enforces the format at
write time so a typo can't ship.

## Lifecycle

1. **Create** the flag at `enabled=true, rolloutPercentage=0` so the
   self-evaluator returns `false` for every user.
2. **Add yourself** to `cohorts.uids` for QA — you'll be on, everyone
   else off.
3. **Ramp**: 0 → 10 → 50 → 100. Wait at least 24 hours between bumps to
   give Sentry / dashboards a chance to surface regressions.
4. **Hold at 100% for ~30 days.**
5. **Clean up.** When the flag has been at 100% for 30+ days the admin
   UI marks it "Candidate for cleanup." Remove the flag from the call
   sites first, deploy, then `DELETE /api/admin/flags/{key}` (or
   `python scripts/flag.py delete <key>`).

## Cohort overrides

Cohort membership wins over the percentage:

- `cohorts.uids` — explicit allowlist. Use for QA, internal pilots,
  apologies-in-progress.
- `cohorts.orgIds` — every member of the listed orgs. Use for org-by-org
  rollout (e.g. pilot church first, then the rest).
- `cohorts.roles` — `admin` is the only platform role today. Group-leader
  is per-group and not surfaced as a cohort here.

## CLI (incident response)

If the admin UI is down or you're paged off-hours:

```bash
cd backend
# Show every flag
python scripts/flag.py list

# Inspect one
python scripts/flag.py get presence_enabled

# Disable in an emergency (preserves the percentage so you can restore)
python scripts/flag.py disable presence_enabled

# Bring back at the last percentage
python scripts/flag.py set presence_enabled --enabled true --pct 50

# Drop a flag entirely (after the call sites are gone)
python scripts/flag.py delete presence_enabled
```

Every CLI write attributes the actor as `cli:<unix-username>` (override
with `--actor`) and writes an `audit_log` row.

## Cleanup discipline

Long-lived flags are debt. The admin list page surfaces a "Candidate for
cleanup" filter that picks any flag with `fullRolloutAt` more than 30
days old. The intent: every quarter, clear that list.

Cleanup order:

1. Remove the `useFlag('x_enabled')` calls from the frontend; the
   gated code becomes unconditional.
2. Remove the server-side `evaluate_flag('x_enabled', ...)` calls.
3. Deploy. (At this point the flag exists but nothing reads it.)
4. Wait one release cycle (so any rollback target also has the flag-free
   code).
5. `DELETE /api/admin/flags/x_enabled` (UI button or CLI).
6. The `audit_log` retains the history.

## How evaluation works (so you can predict bucket assignment)

Bucket = `sha256(f"{uid}:{flagKey}").digest()[:4]` interpreted big-endian
mod 100. Same uid + same flag key → same bucket forever. So a user who
sees the feature at 50% will keep seeing it as you ramp 50 → 60 → 70.

Cohorts are evaluated first and short-circuit. Then `enabled=false`
short-circuits to off. Then the bucket vs. percentage comparison.

Unit-test fixtures in `backend/tests/test_flags.py` pin a few example
(uid, flag) → bucket pairs so any future client-side evaluator can
reproduce the same buckets.

## Caching and propagation

The frontend hook (`frontend/lib/flags.ts`) fetches `GET /api/flags`
once on mount and revalidates roughly every 60 seconds. So a flag
toggle in the admin UI takes up to ~60s to land in another open tab.
This is a deliberate trade against the spec's 5-second target — the
M6 architecture forbids direct Firestore listeners, and 60s is fine
for staged-rollout granularity. If you need an instant flip during an
incident, ask affected users to refresh.

## What flags should *not* be used for

- **Authorization.** A flag is not a permission check. Always pair a
  flag with the existing role/membership predicates.
- **Killing security-relevant code paths.** If you need to disable a
  surface for safety reasons, ship a code change, not a flag toggle —
  a flag at 100% is one accidental edit away from re-enabling a CVE.
- **Long-lived A/B experiments.** Phase 4 problem.

## SLOs

- Read latency p95 ≤ 200 ms (one Firestore collection scan).
- Mutation latency p95 ≤ 400 ms (one set + one audit_log write).
- 100%-for-30+-days flag count: target zero per quarterly cleanup.
