# Text moderation — tuning, false-positive triage, kill switch

This runbook covers operating the T20 text-moderation pipeline once
it's live in production: how to read the auto-flagged queue, how to
tune sensitivity for a specific group, and how to kill the trigger
quickly when it misbehaves.

## At a glance

| Knob | Where | Effect |
|------|-------|--------|
| Per-group policy | `groups/{gid}.moderationPolicy` (`lenient \| standard \| strict`) | Scales hide/flag thresholds for that group only. |
| Daily call cap | `JACOB_TEXT_MODERATION_DAILY_CAP` env var on the Cloud Function (default 5,000) | Hard limit on NL API calls per UTC day. |
| Kill switch | `MODERATION_TEXT_DISABLED=true` env var | Trigger no-ops without redeploy. |
| Circuit breaker | process-local, 5 errors → open 5 min | Stops bleed when the API is unhealthy. |

## Sensitivity defaults

```
lenient   hide=0.95  flag=0.85
standard  hide=0.85  flag=0.70   ← default for new groups
strict    hide=0.70  flag=0.50
```

The `Sexual` category is always hidden once its confidence ≥ 0.70 (the
strict-tier hide threshold), regardless of policy. Other categories use
the policy thresholds as-is.

## Tuning a group's policy

A group leader sets policy via:

```sh
curl -X POST -H "Authorization: Bearer <id-token>" \
  -H "Content-Type: application/json" \
  -d '{"policy": "lenient"}' \
  https://api.jacob.app/api/admin/groups/$GID/moderation-policy
```

Frontend equivalent: a leader-only control on the group settings page
(arrives in T23). Until then, only `curl` / Admin SDK can set it.

The change takes effect immediately for *new* messages — older messages
keep whatever policy was in force when they were scored. Re-scoring is
deliberately out of scope for T20; if a leader needs to clear an
auto-hide from before a policy change, an admin must do it manually:

```python
# scripts/clear_moderation_hold.py — run with Admin SDK
ref = db.collection("groups").document(gid).collection("messages").document(mid)
ref.update({"moderation.state": "scored"})
```

## False-positive triage

When the auto-hide rate jumps:

1. Open `/admin/queue?status=pending&reason=auto-text-moderation`. Sort
   by severity desc.
2. For each row, click through to the resource. Score breakdown is
   stored at `messages/{mid}.moderation.scores`.
3. Common patterns:
   - **Profanity at 0.7+** in groups where casual swearing is normal —
     bump the group to `lenient`.
   - **Toxic at 0.9+** for a one-word message ("dumb") — Cloud NL is
     known to be aggressive on short text. Reject the moderation row
     (Approve in the queue means "leave content live"; Reject means
     "content stays hidden") and consider strictening only for that
     group.
   - **Sexual flagged on Bible verse references** (rare but happens
     for OT lament passages). Approve to release, then capture the
     verse as a known-FP example for future tuning.

## Kill switch (when to use it)

Set `MODERATION_TEXT_DISABLED=true` on the Cloud Function and redeploy
when:

- Cloud NL is returning 5xx for >10 minutes and the circuit breaker is
  flapping.
- A bug in the function is over-hiding messages (the Sentry rule
  `moderation_text_decision` rate is 10× normal).
- A privacy / legal incident requires us to stop sending message bodies
  to Google.

When the switch is on, every new message ships with no `moderation`
field — the queue won't auto-flag, but human reports (T19) still work.

## Cost monitoring

The daily counter lives at `moderation_state/text-{YYYY-MM-DD}`. To see
recent days:

```python
for doc in db.collection("moderation_state").stream():
    print(doc.id, doc.to_dict()["count"])
```

Sentry should fire a `moderation_quota_warning` alert at 80% of the cap.
If the quota is exceeded multiple days running, raise the cap (carefully
— Cloud NL pricing is $0.0005 / call → $2.50 / day at the default cap).

## Multi-language

Cloud NL `moderateText` supports English best; other languages are
opportunistically supported. We do not tune for non-English in T20 —
non-English messages may be scored with low confidence across the board
and pass through to a human reviewer.

## Edit-time re-scoring (deferred)

A user editing a flagged message does not currently trigger re-scoring.
If the moderation team wants to re-evaluate after an edit, run the
clear-hold snippet above and (manually) re-trigger the function via:

```sh
firebase functions:shell
> onMessageCreate({...synthetic event...})
```

A Phase 3 task will wire this up automatically.
