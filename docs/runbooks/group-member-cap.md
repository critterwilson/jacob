# Group member cap

## What it is

Every group has a **soft member cap** — a maximum number of members the normal join flow will admit. The ministry default is **20 members**.

This is a *soft* cap: no existing member is removed if a group is already over 20 (for example, after the initial deploy of this feature). The cap only blocks *new* joins once the limit is reached.

## When someone tries to join a full group

The backend returns a `409 group_at_cap` error. The frontend shows:

> "This group has reached its member limit. The group leader can raise the cap to add more members."

The join attempt is blocked; no member document is written.

This applies to all three join paths:

| Path | Where cap is checked |
|------|----------------------|
| Invite-code join (`POST /api/groups/join`) | Inside the Firestore transaction that consumes the invite |
| Open-mode join (`POST /api/groups/{gid}/join-requests` with `joinMode=open`) | Inside a dedicated Firestore transaction |
| Join-request approval (`POST /api/groups/{gid}/join-requests/{uid}/approve`) | Inside the existing approval transaction |

## Raising the cap (group leaders)

1. Open the group's **Settings** page (`/groups/{gid}/settings`).
2. Find the **Member cap** section.
3. Enter the new limit (must be ≥ current member count) and click **Save cap**.

This calls `PATCH /api/groups/{gid}/cap` and writes `memberCap` to the Firestore group document.

## Raising the cap (platform admins)

Platform admins can call the same endpoint without needing to be a group member:

```bash
curl -X PATCH https://<backend>/api/groups/<gid>/cap \
  -H "Authorization: Bearer <admin-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"memberCap": 50}'
```

## Backfilling existing groups

On first deploy, run the one-shot migration script to set `memberCap` on all existing groups:

```bash
GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
GOOGLE_CLOUD_PROJECT=jacob-prod \
python infra/scripts/backfill_member_cap.py --dry-run

# if the dry-run looks correct:
python infra/scripts/backfill_member_cap.py --apply
```

The script sets `memberCap = max(20, current memberCount)` for every non-archived group, so no already-established group is placed over-limit on day one.

## Firestore field reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `memberCap` | `int` | `20` (new groups) | Set by `backfill_member_cap.py` on existing groups |
| `memberCount` | `int` | — | Existing denormalized counter; not changed by this feature |

## FAQ

**Can I lower the cap below the current membership?**  
No. The PATCH endpoint rejects any `memberCap` value lower than the current `memberCount`.

**What happens to pending join requests when the group becomes full?**  
Pending requests stay pending. A leader can still approve them once the cap is raised. Approving when at cap returns `group_at_cap`; raise the cap first.

**Does the cap count leaders?**  
Yes — `memberCount` includes all roles (leader + member), and `memberCap` is checked against `memberCount`.
