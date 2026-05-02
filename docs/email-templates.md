# Email templates (T18)

JACOB sends three categories of transactional email, all routed through
SendGrid.  Firebase handles its own email-verification and password-reset
flows — those are configured via the Firebase console with JACOB branding.

## App-originated templates

| Template | Trigger | File |
|---|---|---|
| `moderation_notice` | Moderator rejects a report (`POST /api/admin/moderation/{id}/resolve` with `resolution=reject`) | `backend/app/templates/email/moderation_notice.{html,txt}.j2` |
| `deletion_confirmation` | User requests account deletion (`POST /api/account/delete`) | `backend/app/templates/email/deletion_confirmation.{html,txt}.j2` |
| `deletion_finalized` | Scheduler finalizes deletion after 14-day grace window | `backend/app/templates/email/deletion_finalized.{html,txt}.j2` |

## Template variables

### `moderation_notice`

| Variable | Description |
|---|---|
| `display_name` | Recipient's display name |
| `reason` | Reason string from the moderation queue item |
| `resource_type` | `"message"` or `"photo"` |
| `appeal_email` | Email address for appeal contact (defaults to `EMAIL_REPLY_TO`) |

### `deletion_confirmation`

| Variable | Description |
|---|---|
| `display_name` | Recipient's display name |
| `grace_days` | Grace period length in days (currently 14) |
| `finalize_date` | Human-readable date when deletion will occur, e.g. `May 15, 2026` |

### `deletion_finalized`

| Variable | Description |
|---|---|
| `display_name` | Recipient's display name |

## Local development

Leave `SENDGRID_API_KEY` empty.  The email service will log a warning and
skip the send — no real emails are delivered, and no API calls are made.

## Retry behaviour

The service retries failed sends up to 3 times with exponential back-off
(1 s → 2 s → 4 s).  After all attempts are exhausted the exception is
forwarded to Sentry and re-raised.  Callers on write paths (deletion,
moderation resolution) catch the exception so that an email outage never
blocks a user-visible operation.

## Firebase email templates

Firebase Authentication sends email-verification and password-reset emails
automatically.  Configure the sender name, From address, reply-to, and
branding in the Firebase console under
**Authentication → Templates**.  Capture screenshots of each template
(Gmail, Apple Mail) here after the production domain and SendGrid sender
identity are verified.

### Screenshot checklist

- [ ] Email verification — Gmail desktop
- [ ] Email verification — Apple Mail iOS
- [ ] Password reset — Gmail desktop
- [ ] Password reset — Apple Mail iOS
- [ ] `moderation_notice` — Gmail desktop
- [ ] `moderation_notice` — Apple Mail iOS
- [ ] `deletion_confirmation` — Gmail desktop
- [ ] `deletion_confirmation` — Apple Mail iOS
- [ ] `deletion_finalized` — Gmail desktop
- [ ] `deletion_finalized` — Apple Mail iOS

## SPF / DKIM / DMARC

Before launch, verify the sending domain via SendGrid's Domain
Authentication wizard and add the resulting DNS records.  Run
[mail-tester.com](https://www.mail-tester.com) and confirm a score ≥ 9/10.
