# Wellbeing Moderation Runbook

A wellbeing flag is a confidential pastoral concern about a member — not a content violation. The goal is to get a caring person in contact with someone who may be struggling.

## Who can act

Users with the `moderator` custom claim (or `admin`) have access to `/admin/wellbeing`. Moderators see only the Wellbeing tab. Admins see the full admin panel plus Wellbeing.

Grant or revoke the moderator claim via the API (admin-only):

```
POST /api/admin/users/{uid}/moderator
{"grant": true}   # or false to revoke
```

List current moderators: `GET /api/admin/moderators`

## Receiving a concern

A wellbeing flag arrives as `status: open` in the queue at `/admin/wellbeing`.

Each card shows:
- **Reporter** — UID of the person who filed the concern
- **Concerning** — UID of the person flagged (the subject)
- **Note** — the reporter's free-text observation
- **Linked message** (if message-level) — link to the chat context
- **Timestamp**

**The subject is never notified** that a flag was filed.

## Workflow: Open → In progress → Resolved

Every status transition requires a note.

### 1. Open → In progress

When you start reaching out, move the flag to **In progress**. In your note, describe:
- Who you plan to contact or have already contacted
- What channel (phone, DM, in person)
- When you plan to follow up

### 2. In progress → Resolved

When no further moderator action is needed, move to **Resolved**. You will see this prompt:

> Resolved means no further moderator action is needed — not that the person's struggle is over. Document who you reached out to and what was decided.

In your note, include:
- Who you spoke with and when
- What was communicated or offered
- Any referral made (counseling, pastoral care, crisis line)
- Whether ongoing informal check-ins are planned

## Audit trail

Every status transition is audit-logged. To view the history of a specific flag:

```
GET /api/admin/wellbeing/{item_id}/audit
```

The `status_history` subcollection in `moderation_queue/{item_id}` is the durable record. The `audit_log` collection has a parallel entry for each transition.

## Emergency situations

If a reporter indicates someone is in **immediate danger**, do not wait for the queue:
- Contact 911 if you know a physical location
- Share the **988 Suicide & Crisis Lifeline** with the reporter and, if appropriate, with the subject directly

The post-submission acknowledgment shown to reporters already instructs them to call 911 or 988 for emergencies.

## Data handling

- Wellbeing flags live in `moderation_queue` with `reason: "wellbeing_concern"`.
- Status and notes are stored in the `status_history` subcollection.
- Firestore security rules deny all direct client access; only the backend (Admin SDK) can read or write these documents.
- Do not screenshot or forward flag content outside secure channels.
