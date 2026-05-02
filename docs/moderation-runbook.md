# Moderation runbook

## Google Form setup

The report form is created manually in Google Forms. Once created, paste the real form ID and entry IDs into `frontend/lib/report-url.ts` (`FORM_ID` and `ENTRY.*` constants).

### Finding entry IDs

1. Open the published form URL.
2. Right-click the page → **View Page Source**.
3. Search for `entry.` — each field has a data attribute like `data-params="%.@.[123456789,..."`. The numeric ID after `entry.` is what you need.
4. Map each ID to the corresponding constant in `ENTRY`:

| Constant | Form field label |
|---|---|
| `ENTRY.contentType` | Content type (message / profile / group / other) |
| `ENTRY.contentId` | Content ID |
| `ENTRY.groupId` | Group ID |
| `ENTRY.reporterUid` | Reporter UID |
| `ENTRY.timestamp` | Timestamp (ISO 8601) |

### Form fields

Create a Google Form with these fields (all optional so anonymous reports can submit without a reporter UID):

- **Content type** — multiple choice: message, profile, group, other
- **Content ID** — short answer
- **Group ID** — short answer
- **Reporter UID** — short answer
- **Timestamp** — short answer
- **Reason** — paragraph (free text; not pre-filled — the reporter types this themselves)

Link the form responses to a Google Sheet via **Responses → Link to Sheets**.

## Triage process

Moderators review the linked Sheet daily. Suggested SLA:

| Severity | Target response |
|---|---|
| Hate speech / CSAM suspicion | Within 1 hour (escalate immediately — see below) |
| Harassment / threats | Within 4 hours |
| Spam / off-topic | Within 24 hours |
| Other | Within 48 hours |

**Steps:**
1. Open the linked Sheet. New responses appear in the last row.
2. Review the content identified by `Content type` + `Content ID`.
3. If actionable, use the Admin Dashboard (`/admin/queue`) to approve/reject the item and optionally ban the user.
4. Mark the Sheet row as reviewed (e.g., add a "Reviewed" column and set it to `✓`).

## Escalation

- **CSAM suspicion:** immediately report to NCMEC (CyberTipline) and disable the account. Do not investigate further yourself.
- **Credible threats of violence:** contact local law enforcement if you know the reporter's location; otherwise escalate to the platform owner.
- **Platform owner contact:** christopherwilsontry@gmail.com

## Anonymous reports

If `Reporter UID` is blank the report is anonymous. Treat it the same as a named report — anonymous reports are allowed by design (see T12 spec).

## Notes

- The report link opens a pre-filled Google Form in a new tab. No server-side request is made on click; nothing is logged.
- Phase 2 will replace this with a native in-app reporting flow with status visibility for the reporter.
