# JACOB — Phase 2 implementation spec (T23–T39)

> Working specification for the remaining Phase 2 tasks. T19–T22 have shipped
> and are referenced as the prevailing convention. Read this document with
> `docs/phase-2-dev-plan.md` open in another tab — this doc resolves
> ambiguity in the plan and pre-decides architectural choices so that a
> Sonnet session can read one section and start coding without a planning
> round-trip.
>
> **Authoritative sources, in priority order:** (1) `CLAUDE.md` for project
> conventions, (2) `firestore/firestore.rules` for who-can-do-what, (3) this
> document for per-task scope, (4) `docs/phase-2-dev-plan.md` for the
> originating goal statement.
>
> If something here disagrees with `CLAUDE.md`, `CLAUDE.md` wins and this
> file is wrong — open a PR to fix it.

---

## 0. How to read this document

### 0.1 Per-task structure

Every task section follows the same template:

1. **Goal** — 1–2 sentences, the *why*.
2. **Acceptance criteria** — copied from the plan, refined.
3. **Files to create / modify** — with line-anchored hints when
   non-obvious.
4. **Data model changes** — new docs, fields, type shapes.
5. **Firestore rule deltas** — concrete predicate snippets.
6. **Backend interface** — endpoints with method, path, pydantic
   shape, rate-limit decorator, audit-log entries.
7. **Frontend interface** — components, hooks, routes, ownership.
8. **Cloud Functions** — triggers, idempotency, retry/error policy.
9. **Test plan** — specific test names + assertions.
10. **Edge cases / gotchas** — pre-decided traps.
11. **Migration / rollout** — flags, back-fills, env vars.
12. **Dependencies** — upstream tasks.
13. **Estimated complexity** — matches the plan's sizing.
14. *(Opus-flagged tasks only)* **Why Opus** — judgment calls / novel
    patterns that justify the model choice.

### 0.2 How to start a Sonnet session against a task here

```
Implement task T<NN> from docs/phase-2-impl-spec.md. Read the task section
fully, then propose a 5-bullet plan before writing code. Stop and ask if any
acceptance criterion is ambiguous or any pre-decision in the spec disagrees
with the existing codebase.
```

Then approve, let Sonnet implement, and review against acceptance
criteria. The "Edge cases / gotchas" subsection is the single most useful
review checklist — every bullet there is a known foot-gun that has
either bitten the codebase before or is plausible from the surface area.

### 0.3 Pre-decided defaults (apply unless the task says otherwise)

These are decided once here so each task spec doesn't repeat them:

- **Real-time vs polling:** `onSnapshot` for collections under active
  view (chat, member list, pinned bar, reactions, mute/block sets); a
  one-shot `getDocs` / fetch for everything else (settings forms,
  analytics dashboards, admin queue rows older than the visible page).
  Listeners are torn down on unmount.
- **Validation:** **Both ends.** Zod on the frontend (mirrors the
  Pydantic v2 shape one-to-one — copy the field constraints by hand),
  Pydantic on the backend, Firestore rules pin types/lengths
  separately. The rules are the load-bearing layer; the others are UX.
- **SSR vs CSR:** Anything reading Firestore in real time is a
  `"use client"` component. Pages that render purely from props or
  static content stay server components. Settings pages, member list,
  chat, queue, analytics, search results — **all client**. Public
  marketing pages (`/about`, `/faq`) — server.
- **Indexes:** Add new composite indexes to
  `firestore/firestore.indexes.json`, not the console. Each task spec
  enumerates the new entries.
- **Transactions vs batched writes:** Use a transaction whenever a
  read participates in the write decision (counter increment with cap,
  atomic invite consumption, leader-count guard). Use a batched write
  for two-or-more writes that are conceptually one operation but don't
  read the data they modify (group create + bootstrap member create).
  When in doubt, transaction. Slowapi rate-limits already cover
  contention starvation.
- **Audit log:** Every mutating admin/leader action goes through
  `app/services/audit.py:write_audit_log(actor_uid, action, target_ref, payload)`.
  Don't write audit rows directly. The `action` string is
  snake_case, namespaced when useful (`group_archive`, `invite_revoke`,
  `pin_message`, `announce_message`, `export_request`).
- **Logging:** Every backend log line includes `request_id` (set by
  `StructuredLoggingMiddleware`); functions logs include `eventId` and
  the relevant doc path params. Never log message bodies, ID tokens,
  or full image bytes.
- **Errors:** `APIError(status_code, code, message, details)` from
  `app/errors.py`. The `code` is a snake_case string constant that the
  frontend can switch on (`already_member`, `invite_expired`,
  `invite_maxed`, `invite_revoked`, `archived`, `leaderless`, `forbidden`,
  `not_a_leader`, `founder_immutable`, `last_leader`, `pin_limit`).
- **Soft delete vs hard delete:** Always soft-delete user content
  (`deletedAt = serverTimestamp()`). Hard-delete only structural
  records (invite codes, devices, mute/block docs, export jobs).
- **Time:** Server timestamps. Comparisons against "now" use
  `datetime.now(UTC)` in Python and `Timestamp.now()` in TypeScript;
  rule predicates use `request.time`.
- **Rate-limit keys:** Every authenticated mutating endpoint needs an
  `@limiter.limit(...)` decorator. New surface → add a constant to
  `backend/app/limits.py` rather than inlining a string.

If a task makes a decision that contradicts this list, it says so
explicitly and explains why.

### 0.4 Glossary of repeated patterns

These are referenced by name from the per-task sections.

#### Pattern P1 — *audit-log-write*

Every admin/leader action that mutates Firestore goes through
`write_audit_log` after the mutation succeeds. Standard call shape:

```python
write_audit_log(
    actor_uid=user.uid,
    action="<verb_object>",        # snake_case, e.g. "archive_group"
    target_ref="<firestore-path>", # e.g. f"groups/{gid}"
    payload={...},                 # dict[str, JSONable]; never include
                                   # request bodies or PII larger than
                                   # 1 KB; reasoned summaries only.
)
```

The `audit_log` collection has `allow read, write: if false`; it is
written exclusively via the Admin SDK. The audit row is the only durable
trail for moderator-visible actions.

#### Pattern P2 — *leader-or-admin gate*

Many backend endpoints accept either the platform admin custom claim
*or* a leader role on the target group. Mirrors `set_moderation_policy`
in `backend/app/routers/admin.py:483-515`. Copy that shape verbatim:

```python
is_platform_admin = user.claims.get("admin") is True
if not is_platform_admin:
    member_snap = (
        db.collection("groups").document(gid)
        .collection("members").document(user.uid).get()
    )
    if not member_snap.exists or (member_snap.to_dict() or {}).get("role") != "leader":
        raise APIError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="forbidden",
            message="Only group leaders may perform this action",
        )
```

Do **not** put this on every leader endpoint by hand — extract to a
helper `_require_leader_or_admin(db, gid, user)` and call it from each
route. (This helper does not exist yet; the first task that needs it
should create it in `backend/app/routers/groups.py` next to
`_require_leader`.)

#### Pattern P3 — *idempotent Cloud Function trigger*

Mirrors `functions/src/onMessageWrite.ts` and
`functions/src/onMemberWrite.ts`. Required for *every* new Firestore
trigger:

1. `region: "us-central1"`, `maxInstances: 10`, `retry: false` in the
   options object.
2. Compute the change (pure helper exported for unit tests where
   possible — see `classifyChange` and `leaderDelta`).
3. Run a transaction that:
   a. Reads `<parent>/<events_subcollection>/{eventId}`.
   b. Returns early if it exists (logged at `info` level).
   c. Sets the event marker with `processedAt: serverTimestamp()`.
   d. Performs the actual mutation via `FieldValue.increment` /
      `arrayUnion` / `set` with `{merge: true}`.
4. Wrap in `try/catch`. On caught error: `logger.error("<trigger>_failed", { eventId, ...params, error: err.message })` then `throw err` so the function status reflects failure (Cloud Run retries are off, so the throw is for observability).
5. Lazy-init external clients (`getNLClient` shape from `onMessageCreate.ts:50-57`) to keep cold start cheap and unit tests free of network.

The events subcollection naming convention:
- Counters on a parent doc (threadReplyCount, leaderCount,
  reactionCounts) → `<parent>/<noun>_events/{eventId}`
  (`messages/{mid}/_events/`, `groups/{gid}/_member_events/`,
  `messages/{mid}/_reaction_events/`).
- Top-level fan-out (notifications, search index updates) → no
  per-target idempotency record needed if the operation itself is
  idempotent (e.g. Typesense upsert is keyed by message id).

#### Pattern P4 — *paginated leader/admin list*

Cursor-based pagination using a doc-id cursor. Mirrors
`list_moderation_queue` in `backend/app/routers/admin.py:122-204`. The
endpoint accepts `cursor: str | None`, `limit: int = 20` (max 100),
fetches `limit + 1` rows, returns `nextCursor = page[-1].id` if a
`limit + 1`-th row exists. The frontend hook stores the cursor stack
on a `useRef` so "back" is local and "next" appends the next page.

#### Pattern P5 — *moderated upload pipeline reuse*

When a task introduces a new image surface (group avatar, board
attachment, etc.), it reuses T10's existing
`POST /api/uploads/photos` + `POST /api/uploads/{id}/finalize`
endpoints. The only delta is `purpose` — extend the
`CreateUploadRequest.purpose` `Literal[...]` to add the new value, and
extend the membership check inside `create_photo_upload` to map the
new purpose to its required permission (e.g.
`purpose == "group_avatar"` requires `_is_group_leader(db, gid, uid)`,
not just member). Do **not** introduce a parallel upload endpoint — the
moderation pipeline (CSAM hash + SafeSearch) must stay the only path
to the public bucket.

#### Pattern P6 — *zod-mirror-pydantic*

Frontend forms use `react-hook-form` + `zod`. The zod schema mirrors
the Pydantic request model exactly. Field names match (camelCase on
both sides — backend pydantic uses camelCase field names because the
JSON wire shape matches the Firestore data model). The zod schema
lives next to the form component, not in `lib/auth-schemas.ts`.

#### Pattern P7 — *notification fan-out*

T24, T27, T34, T35 all share the `users/{uid}/notifications/{nid}`
collection (introduced in T24 and consumed by T34/T35). Document
shape:

```ts
{
  kind: "announcement" | "mention" | "reply" | "digest_send",
  // payload depends on kind:
  groupId?: string,
  messageRef?: string,    // e.g. "groups/g1/messages/m1"
  fromUid?: string,       // mention/reply/announcement actor
  body?: string,          // truncated preview, ≤ 200 chars
  createdAt: Timestamp,   // serverTimestamp on write
  readAt: Timestamp | null,
  deliveredAt: Timestamp | null,
  failedAt: Timestamp | null,
  failureReason?: string,
}
```

The collection is system-only — `allow read: if isUser(uid); allow
write: if false;` — so the client can only read its own notifications.
T24 creates announcement rows directly via the Admin SDK from a
backend endpoint; T27 creates mention rows from
`onMessageCreate.ts`; T34 reads a notification row in
`onNotificationCreate.ts` and dispatches the FCM push; T35 batches
unread rows into the digest. **Mute/block (T21) is enforced at the
fan-out producer side**, not at the consumer side: if A blocked B, do
not write a `mention` row for A when B authors a message that mentions A.

#### Pattern P8 — *circuit breaker around paid external API*

Every paid external call (Cloud NL, Cloud Vision, Typesense, FCM,
SendGrid, Bible API) is gated by:

1. A process-local circuit breaker — 5 consecutive errors → open for
   5 minutes, log `<service>_circuit_open` (mirrors
   `functions/src/services/textModeration.ts`).
2. A daily quota counter — atomic transaction on a
   `<service>_state/<scope>-{YYYY-MM-DD}` doc (mirrors
   `tryReserveQuota` in `onMessageCreate.ts:75-94`). When the cap is
   reached, log `<service>_quota_exceeded` and short-circuit; the
   triggering operation either retries later (background jobs) or
   returns a graceful 503 (interactive endpoints).
3. A kill-switch env var (`<SERVICE>_DISABLED=true`) that makes the
   call a no-op without redeploying.
4. A Sentry alert at 80% of the daily cap (a `<service>_quota_warning`
   log line that the alert policy in `infra/uptime-checks.tf` matches).

Don't reinvent these — extract the helper from `textModeration.ts`
into a shared utility under `functions/src/services/circuitBreaker.ts`
the first time a second consumer needs it (T34 FCM is the natural
extraction point).

#### Pattern P9 — *rule-shape-validate on every write*

Every new `match` block in `firestore.rules` includes:

1. `request.resource.data.keys().hasOnly([...])` on create.
2. `changedKeys().hasOnly([...])` on update (use the existing
   `onlyChanges` helper).
3. Per-field `is <type>` and `.size() <= N` predicates for every
   string and list.
4. Server-time pinning for any timestamp the client supplies
   (`request.resource.data.<field> == request.time`).
5. Identity pinning for any owner field
   (`request.resource.data.<field> == request.auth.uid`).
6. `notBanned()` on every write predicate.

This is what fixed H3 in the May 2026 review. Do not regress it.

### 0.5 Cross-task dependencies surfaced here

| Task | Depends on | Note |
|------|------------|------|
| T23  | T22, P5    | archival blocks message writes; uses moderated upload for avatar |
| T24  | T22, P7    | leaders pin/announce; announcement → notifications fan-out |
| T25  | T22        | leaders rotate invites; invite consumption is transactional |
| T26  | T20, T21, P3 | reaction trigger keyed by event.id; mute/block hides muted-author reactions |
| T27  | T20, T21, P7 | extends onMessageCreate; mute/block suppresses mention notifications |
| T28  | T22, ADR-required | new top-level data path; ADR before code |
| T29  | T16, T22   | reuses Firestore export bucket; leader-or-admin gate |
| T30  | T22, T23   | discovery requires public + non-archived; join-request flow new |
| T31  | T23, T30   | read-only feed of public groups; rule widening for top-level messages |
| T32  | T20, T21, T26, T27 | top-level boards reuse moderation/mute/reactions/mentions |
| T33  | (none — independent) | scheduled job + cached Firestore doc |
| T34  | T24, T27, P8 | consumes `users/{uid}/notifications`; FCM circuit breaker |
| T35  | T29, T18   | digest reads BigQuery views from T29; sends via SendGrid |
| T36  | T11        | offline cache must respect public-bucket semantics |
| T37  | T10, T11   | extends moderation pipeline finalize with derived variants |
| T38  | T03, T14, T18 | reads everything authored by a user across all groups |
| T39  | T01–T18    | hygiene PR — no other task depends on it but every operator does |

### 0.6 Definition-of-done reminder

Every task's PR is "done" only when all of the following pass:

1. Acceptance criteria checked off in PR body.
2. `pnpm --filter jacob-frontend lint && pnpm --filter jacob-frontend type-check && pnpm --filter jacob-frontend test`
3. `cd backend && uv run ruff check . && uv run mypy app && uv run pytest`
4. `firebase emulators:exec --only firestore "pnpm --filter jacob-firestore test"`
5. `cd functions && npm test && npm run build && npm run lint` (only when functions changed)
6. `firestore.rules` and `firestore.indexes.json` are updated together when the data model changes.
7. New env vars are added to **both** the service `.env.example` and the service `README.md`.
8. The PR description has a screenshot or curl trace if user-visible.

---

## T23 — Group settings page (avatar, description, archival) — Sonnet

**Goal:** Give leaders a single page to edit group metadata, upload a moderated
avatar, toggle privacy, and archive a group. Archived groups are read-only
for everyone, but their content remains visible.

### Acceptance criteria

- Leader edits to `name` / `description` propagate within one realtime tick
  and are reflected on the chat page header.
- A non-leader cannot reach `/groups/[gid]/settings` (route guard) and
  cannot write the underlying fields (rules test).
- Avatar upload that fails SafeSearch is rejected (verifies T10 wiring with
  the new `group_avatar` purpose).
- Archived group: `MessageInput` is disabled and shows the archived banner;
  new-message writes from the client are rejected by rules; old messages are
  still readable.
- Unarchiving within 60 days clears `archivedAt` and re-enables writes.
- After 60 days post-`archivedAt`, the group is hidden from each member's
  group list (`useGroups` filters them out) but remains restorable via
  admin tooling.
- Archive / unarchive each write one `audit_log` row.

### Files to create

- `frontend/app/groups/[gid]/settings/page.tsx` — leader-only settings
  page. Loads via `"use client"`, uses `useGroup(gid)` for live group
  data, redirects to `/groups/[gid]` if the current user is not a
  leader.
- `frontend/components/groups/GroupSettingsForm.tsx` — `react-hook-form` +
  `zod` form for `name`, `description`, `isPrivate`. Submit calls
  `setDoc` directly with `{merge: true}` because the rule pins the field
  set; no backend hop.
- `frontend/components/groups/GroupAvatarUpload.tsx` — wraps the existing
  `useUploadPhoto` hook with `purpose: "group_avatar"` and `groupId`.
  On finalize success it writes `groups/{gid}.avatarUrl` directly via
  the Firestore SDK (rule-allowed because the leader is updating an
  allowed field).
- `frontend/components/groups/GroupArchiveDialog.tsx` — confirmation
  modal for `archivedAt` toggle. Two branches: archive (sets
  `archivedAt`) and unarchive (clears it; the modal explains the 60-day
  window).
- `frontend/components/groups/ArchivedBanner.tsx` — top-of-chat banner
  reading "This group is archived. New messages are disabled.
  Unarchive to resume." Only renders when `group.archivedAt != null`.
- `backend/app/routers/groups.py` — extend with
  `POST /api/groups/{gid}/archive` and
  `POST /api/groups/{gid}/unarchive`. (Decision: archive transitions
  go through the backend, not direct client writes, so `audit_log` is
  written reliably and a 60-day-stale unarchive can reject 410.)
- `backend/app/models/group.py` — add `ArchiveResponse`,
  `UnarchiveResponse`.
- `firestore/tests/groups.rules.test.ts` — extend with metadata
  edit / non-leader denial / archive transition / archived-message-write
  denial scenarios.

### Files to modify

- `firestore/firestore.rules`:
  - `groups/{gid}` create (lines 107–122) — add `avatarUrl` and
    `archivedAt: null` to the create-time keys allowlist.
  - `groups/{gid}` update (lines 126–134) — add `avatarUrl` and
    `archivedAt` to `onlyChanges([...])`. `archivedAt` write requires
    `request.resource.data.archivedAt == request.time` on archive and
    `archivedAt == null && resource.data.archivedAt != null` on
    unarchive.
  - `groups/{gid}/messages/{mid}` create (lines 171–189) — add
    `&& get(/databases/$(database)/documents/groups/$(gid)).data.archivedAt == null`
    to reject writes to an archived group. **The `get` adds one read per
    write — acceptable; chat already does several reads per write via
    the membership check.**
- `frontend/lib/hooks/useGroupMessages.ts` — disable the
  `MessageInput` when `useGroup(gid).group?.archivedAt != null`. The
  hook does not fetch the group — the parent passes the archive state
  in. (Hook stays narrow; UI gates input.)
- `frontend/lib/hooks/useGroup.ts` — extend the returned shape with
  `archivedAt: Timestamp | null` and `avatarUrl: string | null`.
- `frontend/lib/hooks/useGroups.ts` — filter out groups with
  `archivedAt < now() - 60d` from the user's home page list. (Live
  groups stay visible regardless; archived-but-recent groups stay
  visible too.)
- `frontend/components/chat/MessageInput.tsx` — accept an `archived?: boolean`
  prop, disable the textarea + send button + show the banner when set.
- `frontend/app/groups/[gid]/page.tsx` — pull `archivedAt` from the
  group; render `<ArchivedBanner />` and pass `archived={true}` to
  `MessageInput`.
- `docs/data-model.md` — add the four new `groups/{gid}` fields:
  `avatarUrl`, `archivedAt`, `archivedBy`, `archiveReason`.

### Data model changes

```ts
groups/{gid}: {
  // existing fields …
  avatarUrl: string | null,        // public-bucket URL or null
  archivedAt: Timestamp | null,    // serverTimestamp on archive
  archivedBy: string | null,       // uid that archived
  archiveReason: string | null,    // optional, ≤ 500 chars
}
```

The defaults (null) are NOT written on existing groups — the rules
treat `null` and "missing" identically (`resource.data.archivedAt == null`
in the message-create predicate is true for both `null` and a missing
field; verify in the rules test). No back-fill is required.

The new schemaVersion stays at 1; this is an additive change.

### Firestore rule deltas

Three concrete edits.

**1. `groups/{gid}` create — add fields to allowlist:**

```
allow create: if isSignedIn() && notBanned()
  && request.resource.data.keys().hasOnly(
       ['name', 'description', 'isPrivate', 'createdBy', 'createdAt',
        'inviteCode', 'memberCount', 'stickerSet', 'schemaVersion',
        'avatarUrl', 'archivedAt'])
  // … existing predicates …
  && (!('avatarUrl' in request.resource.data)
      || request.resource.data.avatarUrl == null)
  && (!('archivedAt' in request.resource.data)
      || request.resource.data.archivedAt == null);
```

(The bootstrap path always creates with `archivedAt: null` explicitly
or omits the field. The backend in `create_group` should pass
`avatarUrl: None, archivedAt: None` for forward-compat.)

**2. `groups/{gid}` update — extend allow list and gate archive:**

```
allow update: if isGroupLeader(gid) && notBanned()
  && onlyChanges(['name', 'description', 'isPrivate', 'inviteCode',
                  'stickerSet', 'avatarUrl', 'archivedAt',
                  'archivedBy', 'archiveReason'])
  // … existing per-field predicates …
  && (!('archivedAt' in changedKeys())
      || (
        // Archive: from null → request.time, with archivedBy == auth.uid.
        (resource.data.archivedAt == null
          && request.resource.data.archivedAt == request.time
          && request.resource.data.archivedBy == request.auth.uid)
        // Unarchive: from non-null → null, archivedBy must clear too.
        || (resource.data.archivedAt != null
          && request.resource.data.archivedAt == null
          && request.resource.data.archivedBy == null)
      ));
```

**3. `groups/{gid}/messages/{mid}` create — reject when archived:**

```
allow create: if isGroupMember(gid) && notBanned()
  && get(/databases/$(database)/documents/groups/$(gid)).data.archivedAt == null
  // … existing predicates …
```

The `get` is fine — the rule already does a `get` for the membership
check. Confirm in a rules test with `archivedAt: <timestamp>` that
client message writes 403.

### Backend interface

`backend/app/routers/groups.py`:

```python
@router.post("/{gid}/archive", response_model=ArchiveResponse)
@limiter.limit(ADMIN_MUTATION)
def archive_group(
    gid: str,
    request: Request,
    response: Response,
    body: ArchiveGroupRequest,
    user: CurrentUser = Depends(get_current_user),
) -> ArchiveResponse:
    ...
```

- **Method/path:** `POST /api/groups/{gid}/archive`,
  `POST /api/groups/{gid}/unarchive`.
- **Auth:** leader of the group (use `_require_leader`).
- **Rate limit:** `ADMIN_MUTATION` (10/min).
- **Pydantic:**
  ```python
  class ArchiveGroupRequest(BaseModel):
      reason: str = Field(default="", max_length=500)
  class ArchiveResponse(BaseModel):
      gid: str
      archivedAt: str  # ISO-8601
  class UnarchiveResponse(BaseModel):
      gid: str
  ```
- **Behaviour:**
  - Archive: read group, refuse with 409 `already_archived` if
    `archivedAt` already set; otherwise update with
    `{archivedAt: SERVER_TIMESTAMP, archivedBy: user.uid, archiveReason: reason}`.
    Write `audit_log` action `archive_group` payload `{reason}`.
  - Unarchive: read group, refuse with 410 `archive_too_old` if
    `archivedAt < now - 60d`, refuse with 409 `not_archived` if
    `archivedAt == null`. Update with
    `{archivedAt: None, archivedBy: None, archiveReason: None}`. Write
    `audit_log` action `unarchive_group`.
- **Error codes:** `forbidden`, `group_not_found`, `already_archived`,
  `not_archived`, `archive_too_old`.

### Frontend interface

- **Route:** `/groups/[gid]/settings` (new). Top-level `"use client"`
  page. Redirects non-leaders to `/groups/[gid]`. Renders three
  cards: Metadata (form), Avatar (uploader), Danger Zone (archive /
  unarchive).
- **State ownership:**
  - `useGroup(gid)` provides realtime group data.
  - `GroupSettingsForm` owns its own `react-hook-form` state,
    submits via direct Firestore `updateDoc`. It does *not* go through
    the backend — the rule is the trust boundary.
  - `GroupAvatarUpload` owns the upload state; on finalize success,
    direct `updateDoc({avatarUrl})`.
  - `GroupArchiveDialog` calls the backend; on success, `useGroup`
    will reflect the change via `onSnapshot`.
- **Zod (P6):**
  ```ts
  const settingsSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    isPrivate: z.boolean(),
  });
  ```
- **Form constraints reflected in UI:** counter for description
  (X/500), name max=100, error states match server's
  `validation_error`.
- **Archived state in chat (`/groups/[gid]/page.tsx`):**
  - Render `<ArchivedBanner />` above `<MessageList />`.
  - Pass `archived={true}` to `MessageInput`. The input renders
    disabled with a tooltip "This group is archived."
  - Members can still scroll and read; reactions (T26) are also
    disabled when `archived` is true (cross-task — call out in T26).

### Cloud Functions

None new. The existing `onMemberWrite` continues to maintain
`leaderCount`. Archive does not touch member docs.

### Test plan

**Backend (`backend/tests/test_groups.py`, extend):**
- `test_archive_group_happy_path` — leader archives; group has
  `archivedAt`, `archivedBy`, audit_log row written.
- `test_archive_group_already_archived_returns_409`.
- `test_archive_group_not_leader_returns_403`.
- `test_unarchive_group_happy_path`.
- `test_unarchive_group_not_archived_returns_409`.
- `test_unarchive_group_too_old_returns_410` — back-date `archivedAt`
  to 61 days ago, assert 410 `archive_too_old`.

**Frontend (`frontend/tests/group-settings.test.tsx`):**
- `non-leader is redirected away from settings page`.
- `metadata edit calls updateDoc with allowed fields only`.
- `archived banner renders when archivedAt is set`.
- `MessageInput is disabled when archived prop is true`.

**Rules (`firestore/tests/groups.rules.test.ts`, extend):**
- `leader can archive (archivedAt = serverTimestamp)`.
- `non-leader cannot archive`.
- `archived: client message write denied`.
- `archived: client cannot send a backdated archivedAt`.
- `unarchive: rule allows clearing archivedAt only after non-null`.
- `archived group: name edit still allowed`.
- `archived group: messages still readable`.

### Edge cases / gotchas

- **`get` cost on every message create.** The new rule adds one
  Firestore read per message create. For a busy group this is real.
  Mitigation: `useGroupMessages` already disables sends when archived,
  so the hot path is rule-side only. Acceptable — rules `get` is
  cheap relative to the write itself.
- **Race: leader archives while a member is mid-send.** The send
  Promise rejects with `permission-denied`. The frontend should
  surface "Group was archived." rather than the generic error string.
  Catch the rejection in `MessageInput`'s send handler.
- **Avatar URL must come from the public bucket.** Reuse the
  client-side `MEDIA_URL_PREFIX` check from
  `frontend/components/chat/MessageItem.tsx:15-19` so a stale
  `avatarUrl` doesn't allow XSS via an `<img src>`. Actually, defend
  in rule too: when updating `avatarUrl`, require it starts with
  `'https://storage.googleapis.com/jacob-media-public-'` or is
  `null`. Add this predicate to the update rule.
- **60-day cutoff on unarchive vs filter cutoff for hide.** Both are
  60d but they're different cutoffs (archive→unarchive deadline vs.
  list-hide). Keep them as one constant in
  `frontend/lib/groups.ts`: `ARCHIVE_HIDE_DAYS = 60`. Backend has the
  same constant in `backend/app/services/groups.py`.
- **Description currently has size cap 500 in the create rule but no
  cap in the rule update branch (line 133).** Add it now while you're
  there: `request.resource.data.description.size() <= 500`.
- **Archived group group-avatar upload.** Block at the backend: if
  group is archived, reject the upload-init with
  409 `archived`. Unarchived edits stay possible.
- **Audit log on every archive transition.** Don't squash multiple
  archive/unarchive within a minute into one row — each is a
  decision point.

### Migration / rollout

- No back-fill needed. Existing groups have no `archivedAt` field;
  rule predicate `resource.data.archivedAt == null` handles the
  missing-field case via Firestore's "field absent → reads as null"
  behavior. Add a rules test that confirms this.
- New env vars: none.

### Dependencies

- T07 (group create), T10 (moderated upload), T22 (leader role).
- Cross-task: T26 (reactions disabled when archived), T27 (mention
  notifications skipped when archived — fan-out producer checks),
  T34 (push not sent for archived groups).

### Estimated complexity

Medium (rules change + backend endpoint + new page + reusable
upload). One Sonnet session, ~1 day.

---

## T24 — Pinned messages + announcements — Sonnet

**Goal:** Leaders can pin up to 5 messages to the top of a group. An
"announcement" is a pin that also fans out a notification to every member.

### Acceptance criteria

- Pinning a 6th message is rejected (server-enforced; rules test).
- Non-leader pin attempts return permission-denied (rules test).
- Posting an announcement writes one notification row per member of the
  group, atomically (or batched with retry-on-failure documented). Verified
  via test that mocks `groupId` with N members.
- Pinned bar is responsive at < 768px (collapses to a single line) and
  updates within one realtime tick when a leader pins/unpins from another
  tab.
- Removing a pin does not delete the underlying message.
- Removing an announcement removes only the pin; the
  `notifications/{nid}` rows remain (audit trail).

### Files to create

- `frontend/components/chat/PinnedBar.tsx` — collapsible bar at the top
  of the chat. Renders the most recent pinned message body
  (truncated to ~80 chars) with a "View all pinned" affordance that
  opens `PinnedSheet`.
- `frontend/components/chat/PinnedSheet.tsx` — bottom-sheet/drawer
  showing all up-to-5 pinned messages with unpin (leader-only) and
  jump-to-message links.
- `frontend/lib/hooks/usePinnedMessages.ts` — listens to the group doc
  for `pinnedMessageIds` array; for each id, looks up the message via
  `getDoc` (5 reads max — fine, small fixed set). Returns an ordered
  list `{message, pinnedAt}[]`.
- `frontend/lib/hooks/useAnnounce.ts` — calls
  `POST /api/groups/{gid}/messages/{mid}/announce`, returns
  `{announce, isPending, error}`.
- `backend/app/routers/groups.py` — extend with
  `POST /api/groups/{gid}/messages/{mid}/announce`. **Pinning itself
  goes through Firestore rules**, not the backend (low-risk leader
  action; rule enforces array length); announcement goes through the
  backend because it triggers cross-collection writes that need
  Admin SDK (the `users/{uid}/notifications/{nid}` collection is
  rule-locked to system-only writes).
- `backend/app/services/notifications.py` — new service: helpers for
  `write_notification`, `bulk_write_notifications`. Used by T24, T27,
  T34, T35.
- `backend/app/models/group.py` — `AnnounceResponse`.
- `firestore/tests/pinned.rules.test.ts` — new file dedicated to pin
  rule scenarios.

### Files to modify

- `firestore/firestore.rules`:
  - `groups/{gid}` create — add `pinnedMessageIds: []` to allowed
    keys; on create, must equal empty list.
  - `groups/{gid}` update — extend `onlyChanges` to include
    `pinnedMessageIds`; require `request.resource.data.pinnedMessageIds is list && size() <= 5`.
  - `groups/{gid}/messages/{mid}` update — extend the existing leader
    branch to permit setting `announcedAt` from `null` to
    `request.time` and **only** that change in addition to
    `deletedAt` (one onlyChanges branch per logical action). Snippet
    below in *Rule deltas*.
  - New collection rule for `users/{uid}/notifications/{nid}`.
- `frontend/components/chat/MessageItem.tsx` — overflow menu adds Pin /
  Unpin (visible to leaders only) and "Pin as announcement" (variant of
  pin that hits the backend).
- `frontend/app/groups/[gid]/page.tsx` — render `<PinnedBar />` between
  the chat header and `<MessageList />`. Pass `gid`, `isLeader`.
- `docs/data-model.md` — document the four new fields:
  `pinnedMessageIds`, `messages.announcedAt`,
  `users/{uid}/notifications/{nid}` (P7 shape).

### Data model changes

- `groups/{gid}`:
  - `pinnedMessageIds: string[]` — ordered, most-recent-first; **max length 5**.
- `groups/{gid}/messages/{mid}`:
  - `announcedAt: Timestamp | null` — set when announced; one-way (never cleared).
  - `announcedBy: string | null` — uid that announced.
- `users/{uid}/notifications/{nid}`: Pattern P7 shape; `kind: "announcement"`.

### Firestore rule deltas

**Update `groups/{gid}` predicate (extends T23 work):**

```
allow update: if isGroupLeader(gid) && notBanned()
  && onlyChanges(['name', 'description', 'isPrivate', 'inviteCode',
                  'stickerSet', 'avatarUrl', 'archivedAt',
                  'archivedBy', 'archiveReason', 'pinnedMessageIds'])
  && (!('pinnedMessageIds' in changedKeys())
      || (request.resource.data.pinnedMessageIds is list
          && request.resource.data.pinnedMessageIds.size() <= 5))
  // … rest of T23 predicates …
```

**Update `groups/{gid}/messages/{mid}` — split into three logical
branches:**

```
allow update: if isGroupMember(gid) && notBanned() && (
  // Author edit (existing) — unchanged.
  (resource.data.authorUid == request.auth.uid
    && onlyChanges(['body', 'editedAt'])
    && request.resource.data.editedAt == request.time
    && request.time < resource.data.createdAt + duration.value(15, 'm'))
  // Author or leader soft-delete (existing) — unchanged.
  || ((resource.data.authorUid == request.auth.uid || isGroupLeader(gid))
    && onlyChanges(['deletedAt'])
    && request.resource.data.deletedAt == request.time
    && resource.data.deletedAt == null)
  // T24: leader announces — only the announcedAt + announcedBy fields
  // change; one-way (must transition from null).
  || (isGroupLeader(gid)
    && onlyChanges(['announcedAt', 'announcedBy'])
    && resource.data.announcedAt == null
    && request.resource.data.announcedAt == request.time
    && request.resource.data.announcedBy == request.auth.uid)
);
```

The leader-set branch is restricted to `null → request.time`, so an
announcement cannot be backdated or repeated.

**New rule for `users/{uid}/notifications/{nid}`:**

```
match /users/{uid}/notifications/{nid} {
  allow read: if isUser(uid);
  // Owner can mark as read by setting readAt; nothing else.
  allow update: if isUser(uid)
    && onlyChanges(['readAt'])
    && request.resource.data.readAt == request.time
    && resource.data.readAt == null;
  // Create and delete are server-only.
  allow create: if false;
  allow delete: if false;
}
```

(The owner can mark read; everything else is system. The `readAt`
gating mirrors the soft-delete pattern.)

### Backend interface

`POST /api/groups/{gid}/messages/{mid}/announce`:

- **Auth:** leader of the group.
- **Rate limit:** `ADMIN_MUTATION`.
- **Body:** none (the act of POSTing is the announcement).
- **Response:** `AnnounceResponse { gid, mid, announcedAt: ISO, notifiedCount: int }`.
- **Behaviour:**
  1. Verify message exists and is in this group.
  2. Verify `announcedAt == null` (else 409 `already_announced`).
  3. In a transaction:
     - Add `mid` to `groups/{gid}.pinnedMessageIds`. If length would
       exceed 5, **drop the oldest** (`array.shift()` semantics —
       remove `pinnedMessageIds[0]`, append new id). Document: this is
       different from rule-only pin which must reject a 6th — the
       backend is allowed to mutate the array more freely because
       it's the only writer when announcing.
     - Update message: `announcedAt = SERVER_TIMESTAMP`, `announcedBy = uid`.
  4. Read all members of the group (collection reference under
     `groups/{gid}/members`). For each member uid (paginate at 500;
     yield to the next batch), in a `users/{uid}/notifications/{nid}`
     write batch (max 500 per batch, server-side; use Admin SDK
     `bulk_write` or a batched commit loop):
     ```python
     {
       "kind": "announcement",
       "groupId": gid,
       "messageRef": f"groups/{gid}/messages/{mid}",
       "fromUid": user.uid,
       "body": message.body[:200],
       "createdAt": SERVER_TIMESTAMP,
       "readAt": None,
       "deliveredAt": None,
       "failedAt": None,
     }
     ```
     **Skip members where `userBlocks(memberUid, fromUid)` exists**
     (P7: mute/block is enforced at fan-out producer). Read each
     member's `users/{memberUid}/blocks/{fromUid}` doc; this is N
     reads on a typically-small set (≤30 members per group v2) —
     acceptable. For larger groups, batch this read using `get_all`.
  5. Write `audit_log` action `announce_message` with payload
     `{messageRef, notifiedCount}`.
- **Error codes:** `forbidden`, `message_not_found`,
  `already_announced`, `archived` (cannot announce in archived group).

`backend/app/services/notifications.py`:

```python
def write_notification(
    db: Any, *, recipient_uid: str, kind: str,
    group_id: str | None, message_ref: str | None,
    from_uid: str | None, body: str | None,
) -> str:
    """Single write. Returns nid."""
    ...

def bulk_write_notifications(
    db: Any, *, recipient_uids: Iterable[str],
    kind: str, group_id: str | None, message_ref: str | None,
    from_uid: str | None, body: str | None,
    skip_blocked_by: bool = True,
) -> int:
    """Returns count actually written. Honors blocks if from_uid is set."""
    ...
```

### Frontend interface

- `<PinnedBar gid={gid} isLeader={isLeader} />` renders inline at
  height 36px (single line) for non-leaders, 36–72px (collapsible) for
  leaders. On mobile (< 768px), single-line, ellipsis.
- `<PinnedSheet pinned={pinned} isLeader={isLeader} onUnpin={...} />`.
- The pin/unpin write is a direct
  `updateDoc(groupRef, { pinnedMessageIds: [...newArr] })`. The hook
  `usePinnedMessages` returns the helper:
  ```ts
  const togglePin = async (mid: string) => {
    const next = isPinned(mid)
      ? pinnedIds.filter((id) => id !== mid)
      : [mid, ...pinnedIds].slice(0, 5); // most-recent-first; cap at 5
    await updateDoc(doc(firestore, "groups", gid), { pinnedMessageIds: next });
  };
  ```
- Mobile: pinned bar collapses to single line; tap to expand.
- Keyboard: pinned bar is focusable, `Tab` cycles "Expand" → first
  pinned title → next.
- Announcement UX: "Pin as announcement" in the message overflow
  menu. Confirmation modal with message body preview and "This will
  notify all N members." copy. Submit → spinner → toast.

### Cloud Functions

None new. The announce endpoint writes notifications directly via
the Admin SDK; T34 will register `onNotificationCreate` later to
dispatch FCM. **The notification fan-out from the backend is
synchronous within the request — keep payloads small (≤200 char body,
no media). For larger groups (>200 members), enqueue a Cloud Tasks
job rather than fanning out in-request — but Phase 2 group sizes
don't warrant it; document this in the runbook.**

### Test plan

**Backend (`backend/tests/test_announcements.py`, new):**
- `test_announce_writes_notifications_for_each_member` — group with
  3 members; verify 3 notification rows.
- `test_announce_skips_blocked_members` — recipient B blocked the
  announcer A; verify only 2 rows for a 3-member group.
- `test_announce_already_announced_returns_409`.
- `test_announce_pins_message` — verify message id appears in
  `pinnedMessageIds`.
- `test_announce_pin_dropoff` — group already has 5 pins; announce a
  6th; verify oldest dropped.
- `test_announce_archived_group_returns_409`.
- `test_announce_audit_log` — assert one `announce_message` row with
  `notifiedCount`.

**Frontend (`frontend/tests/pinned.test.tsx`, new):**
- `pinned bar renders message preview from pinnedMessageIds`.
- `non-leader does not see Pin in the overflow menu`.
- `leader togglePin updates pinnedMessageIds in Firestore`.
- `pinned sheet renders all five pinned with unpin button`.

**Rules (`firestore/tests/pinned.rules.test.ts`, new):**
- `leader can set pinnedMessageIds with ≤ 5 entries`.
- `leader cannot set pinnedMessageIds with 6 entries (denied)`.
- `non-leader cannot update pinnedMessageIds`.
- `notifications/{nid} create is denied to client`.
- `owner can mark notification read (readAt = serverTimestamp)`.
- `owner cannot delete notification`.
- `non-owner cannot read others' notifications`.

### Edge cases / gotchas

- **5-vs-6 in client toggle.** `togglePin` does
  `[mid, ...pinnedIds].slice(0, 5)` — if the user pins a 6th from the
  client, the rule rejects 6 entries; we enforce by `slice` first to
  avoid the round-trip. Test asserts that the client's
  `togglePin` produces at most 5 entries before writing.
- **Race: two leaders pin simultaneously.** The Firestore write is
  last-write-wins; the most recent pin survives. Acceptable — pinning
  is a soft action and conflict is rare. Document in PinnedSheet UX
  ("If you don't see your pin, refresh").
- **Announce a deleted message.** Reject with 409
  `message_deleted` in the backend. Test it.
- **Announce a thread reply.** Same fan-out logic; the spec says
  "every member of the group", so threading doesn't change the
  recipient list. Keep it.
- **Notification body truncation.** Strip newlines, take first 200
  chars. Long Unicode (e.g. emoji) — use `.slice(0, 200)` not
  `.substr(0, 200)` (deprecated). The truncation is for the
  notification preview only; the linked message preserves the full
  body.
- **Recipient pulled while announcement is fanning out.** A user who
  leaves between the start of the fan-out and their write is fine —
  their notification doc is orphaned but unreadable (rule denies
  non-owner reads). Acceptable.
- **Member count in the announcement UX.** Read `memberCount` from
  the group doc, not by counting members in real time. This is
  cached; off by ±1 occasionally if a member just joined/left, which
  is fine for a confirmation copy.
- **`announcedAt` is one-way per the rule.** Repeat-announce is
  possible only via the backend, which guards on
  `already_announced`.
- **Archived group cannot announce.** Backend checks
  `archivedAt == null` before fan-out; rules also reject the message
  update because the group is archived (the message-update branch
  doesn't itself check archive — add a `&& get(...).archivedAt == null`
  there too, mirroring T23's pattern).

### Migration / rollout

- No back-fill needed; existing groups have no `pinnedMessageIds`,
  reads return `undefined` → `[]` in the hook.
- New env vars: none.

### Dependencies

T22 (leader role); P7 (notifications collection introduced here).
Consumed by T34 (push), T35 (digest).

### Estimated complexity

Medium-large (new collection, new endpoint, fan-out + blocks check).
One Sonnet session, ~1.5 days.

---

## T25 — Invite-link expiry, single-use codes, invite tracking — Sonnet

**Goal:** Replace the single forever-`inviteCode` field with a managed
collection of invite docs that have expiry, max-uses, and tracking.

### Acceptance criteria

- A 1-hour invite that has elapsed returns 410 on join attempt and shows
  "expired" in the leader's invite list.
- A single-use invite that's already been used returns 410 with
  `invite_maxed`.
- The migration script run against the dev project moves every existing
  `groups/{gid}.inviteCode` into the new collection; the legacy field
  becomes `null`. Backend tests cover both pre- and post-migration code paths.
- Backend tests cover: create, list, revoke, join expired, join maxed,
  transactional double-use under concurrent joins (use Firestore emulator
  transaction semantics).
- Leader can see active invites with usage count and last-used timestamp.

### Files to create

- `backend/app/routers/invites.py` — new router. (Decision: keep invite
  endpoints out of `routers/groups.py` — that file is already over 380
  lines and gets bigger in T22+T23; a new router keeps blast radius
  small.)
- `backend/app/services/invites.py` — code generation, expiry math,
  transactional consume. Pure helpers + the join flow logic moved from
  `routers/groups.py:join_group`.
- `backend/app/models/invite.py` — pydantic models.
- `frontend/app/groups/[gid]/settings/invites/page.tsx` — leader invite
  management UI.
- `frontend/components/groups/InviteForm.tsx` — create-invite form.
- `frontend/components/groups/InviteList.tsx` — table with usage count
  and copy-link.
- `frontend/lib/hooks/useInvites.ts` — `onSnapshot` subscription on the
  group's invite list.
- `backend/scripts/migrate_invite_codes.py` — one-shot migration.
- `firestore/tests/invites.rules.test.ts`.

### Files to modify

- `backend/app/routers/groups.py:join_group` (lines 118–161) — replace
  the `inviteCode == body.code` lookup with a call to
  `services/invites.consume_invite(...)`. Existing tests must still
  pass.
- `firestore/firestore.rules` — add rule block for
  `groups/{gid}/invites/{inviteId}`. Read by group members; write only
  via Admin SDK.
- `firestore/firestore.indexes.json` — add composite index on
  `(groupId, createdAt DESC)` (collection-group scope) for the leader
  list.
- `backend/app/limits.py` — add `INVITE_CREATE: str = "20/hour"`.
- `docs/data-model.md` — add the new collection.
- `docs/adr/0004-invite-collection.md` (new ADR) — capture why we
  moved away from the single inviteCode field.

### Data model changes

```ts
// New: groups/{gid}/invites/{inviteId}
{
  code: string,                       // 8 chars, base32, unique within group
  createdBy: string,                  // uid
  createdAt: Timestamp,
  expiresAt: Timestamp | null,        // null = never
  maxUses: number | null,             // null = unlimited
  useCount: number,                   // server-maintained via transaction
  lastUsedAt: Timestamp | null,
  lastUsedByUid: string | null,
  revokedAt: Timestamp | null,
  revokedBy: string | null,
}
```

`groups/{gid}.inviteCode` is **kept for one phase as a deprecation
shim** — set to null after migration. Remove in Phase 3 once all
clients are off the legacy code path. Document this in the ADR.

### Firestore rule deltas

```
match /groups/{gid}/invites/{inviteId} {
  // Members can read invite list; the inviteCode is enough to join,
  // so member visibility is fine.
  allow read: if isGroupMember(gid);
  // All writes via Admin SDK.
  allow create, update, delete: if false;
}
```

### Backend interface

All endpoints prefix `/api/groups/{gid}/invites`:

| Method | Path                              | Purpose |
|--------|-----------------------------------|---------|
| POST   | `/`                               | Create new invite |
| GET    | `/`                               | List invites (leader-only) |
| DELETE | `/{inviteId}`                     | Revoke |

```python
class CreateInviteRequest(BaseModel):
    expiry: Literal["never", "24h", "7d", "30d"]
    maxUses: Literal["unlimited", "1", "10", "25"]

class InviteResponse(BaseModel):
    inviteId: str
    code: str
    url: str               # built from APP_URL + /join?code=
    expiresAt: str | None  # ISO
    maxUses: int | None
    useCount: int
    lastUsedAt: str | None

class InviteListResponse(BaseModel):
    invites: list[InviteResponse]
```

- **Auth:** create/list/revoke require leader (`_require_leader`).
- **Rate limits:** `INVITE_CREATE` (20/h) on create; `ADMIN_MUTATION`
  on revoke.
- **Behavior:**
  - Create: generate 8-char base32 code via `secrets.choice` — collision check **across the same group's invites** (not all of Firestore — that was the H12 problem). Loop up to 5 times. Compute
    `expiresAt = now + delta` for `24h | 7d | 30d` else None. Compute
    `maxUses = int(maxUses)` else None. Write doc with `useCount = 0`,
    `revokedAt = null`. Audit row `create_invite`.
  - List: query `groups/{gid}/invites` ordered by `createdAt desc`.
    Include all invites, mark expired/revoked client-side.
  - Revoke: read existing doc, set `revokedAt = SERVER_TIMESTAMP, revokedBy = uid`.
    Audit row `revoke_invite`.

`backend/app/services/invites.consume_invite(db, code, uid)`:

- Single transaction. Steps:
  1. `db.collection_group("invites").where("code", "==", code).limit(1).get(transaction=tx)` — uses the new collection-group index. **The collection-group read with rule = members-only is fine because the backend uses the Admin SDK which bypasses rules.** Document this so a reviewer doesn't worry.
  2. Validate: doc exists, `revokedAt == null`, `expiresAt is None or expiresAt > now`, `maxUses is None or useCount < maxUses`. Otherwise raise the appropriate `APIError(410, "invite_expired" | "invite_maxed" | "invite_revoked")` or 404 `invalid_invite`.
  3. Read `groups/{gid}/members/{uid}` in the same transaction. If
     exists, raise 409 `already_member`.
  4. Inside the transaction:
     - `tx.update(invite_ref, { useCount: Increment(1), lastUsedAt: SERVER_TIMESTAMP, lastUsedByUid: uid })`
     - `tx.set(member_ref, { role: "member", joinedAt: SERVER_TIMESTAMP, uid })`
     - `tx.update(group_ref, { memberCount: Increment(1) })`
- Returns `(gid, inviteId)`.

The collection-group read inside a transaction is the single subtle
point; document it in the ADR. Test coverage: two concurrent
`consume_invite` calls on a `maxUses=1` invite — one wins with 200,
the other gets 410 `invite_maxed`.

`backend/app/routers/groups.py:join_group`:

```python
@router.post("/join", response_model=JoinGroupResponse)
@limiter.limit(GROUP_JOIN)
def join_group(...):
    db = _db()
    try:
        gid, invite_id = consume_invite(db, body.code, user.uid)
    except APIError:
        raise
    write_audit_log(
        actor_uid=user.uid,
        action="join_group",
        target_ref=f"groups/{gid}/members/{user.uid}",
        payload={"inviteId": invite_id},
    )
    return JoinGroupResponse(groupId=gid)
```

(Replace the existing inviteCode lookup. The legacy
`groups.{gid}.inviteCode` field is still tolerated by the migration —
see Migration.)

### Frontend interface

- **Route:** `/groups/[gid]/settings/invites`. Leader-only (route
  guard like `/groups/[gid]/settings`).
- **InviteForm:** two selects (expiry, maxUses) + a "Generate" button.
  On success, surface the URL with a "Copy" affordance (Clipboard API).
- **InviteList:** table of `code`, `expiresAt` (relative time), uses
  remaining (`maxUses - useCount` or "∞"), `lastUsedAt`,
  Revoke button. Status pill: Active / Expired / Revoked / Used up.
- **Hook:** `useInvites(gid)` listens to
  `collection(firestore, 'groups', gid, 'invites')` ordered by
  `createdAt desc`. Reads only — writes go through the backend.
- **Zod (P6):** mirrors `CreateInviteRequest`.

### Cloud Functions

None.

### Test plan

**Backend (`backend/tests/test_invites.py`, new):**
- `test_create_invite_happy_path`.
- `test_create_invite_collision_retries`.
- `test_create_invite_not_leader_returns_403`.
- `test_consume_invite_happy_path`.
- `test_consume_invite_expired_returns_410`.
- `test_consume_invite_maxed_returns_410`.
- `test_consume_invite_revoked_returns_410`.
- `test_consume_invite_concurrent_maxuses_one_wins` —
  start 2 transactions concurrently against a `maxUses=1` invite;
  one returns 200, other returns 410.
- `test_revoke_invite_writes_audit_log`.
- `test_legacy_inviteCode_field_no_longer_used` — set
  `groups/{gid}.inviteCode = "OLD12345"`, post-migration, attempting to
  join with that code returns 404 `invalid_invite` (the field is no
  longer the lookup path).

**Frontend (`frontend/tests/invites.test.tsx`, new):**
- `non-leader is redirected from invite settings page`.
- `InviteForm Generate calls POST /api/groups/{gid}/invites`.
- `InviteList renders status pill correctly` (active vs expired vs
  revoked vs maxed).
- `Revoke button calls DELETE and updates the row` (rely on
  onSnapshot to refresh).

**Rules (`firestore/tests/invites.rules.test.ts`, new):**
- `member can read invites`.
- `non-member cannot read invites`.
- `client cannot create invite` (Admin SDK only).
- `client cannot update invite` (e.g. cannot bump useCount themselves).
- `client cannot delete invite`.

### Edge cases / gotchas

- **Collision check scope.** The check is *within the group's
  invites*, not platform-wide. Different groups can have the same
  8-char code; the join lookup uses a collection-group query that
  matches on code + (transactionally) on group membership state.
  This is a design simplification — global collision search is too
  expensive. Document in the ADR.
- **Revoked invites stay readable in the list.** Display them
  greyed-out so the leader sees who used them. Filter them out of
  "active" count.
- **Expired but high-use invites.** A 30-day invite that expired
  yesterday with 22 uses: keep the row visible. Audit value > UI
  noise.
- **Soft-revoke vs hard-delete.** Always soft. Hard delete loses
  audit trail. The data-model rule allows delete = false; only Admin
  SDK can hard-delete (Phase 3 cleanup script).
- **Concurrent join with maxUses=1.** Both transactions read
  `useCount = 0`; one commits with `useCount = 1`, the other commits
  if Firestore allows concurrent transactions on the same doc, but
  the second `commit()` retries (Firestore re-runs on conflict) and
  reads `useCount = 1`, then sees `useCount >= maxUses` and raises.
  This is exactly the right behavior — but document that the
  `consume_invite` function relies on Firestore's optimistic
  concurrency for transactions, *not* on application-level locking.
  Test it.
- **Deleted group with active invite.** Group delete is currently
  forbidden by rule; archival doesn't break invites. Decision: an
  archived group's invites remain technically usable from the
  invite-doc perspective, but `consume_invite` should refuse with
  410 `archive_too_old` when `groups/{gid}.archivedAt != null`. Add
  this check explicitly inside the transaction.
- **Leader off-boarding.** When a leader is demoted, their issued
  invites stay valid. Acceptable — it's the group's invite, not the
  leader's. Audit log records who created which.
- **URL shape.** `https://<APP_URL>/join?code=<CODE>`. The frontend
  reads `?code=` on `/join` and submits to the backend. Existing
  `/join` page already does this for the legacy code; no change.

### Migration / rollout

- One-shot `backend/scripts/migrate_invite_codes.py`:
  ```
  for each group in groups (paginated):
      if group.inviteCode is None: continue
      create groups/{gid}/invites/<new-id> with:
          code = group.inviteCode,
          createdBy = group.founderUid (fallback createdBy),
          createdAt = group.createdAt,
          expiresAt = None, maxUses = None, useCount = 0,
          lastUsedAt = None, revokedAt = None
      group.update({ inviteCode: None })
  ```
  Idempotent: if an invite with the same `code` already exists in the
  group, skip the create and proceed with the field nulling.
- Operator runbook: run before deploying the new join code path; CI
  fails on dual-state (legacy field + no invites collection).
- New env vars: `JACOB_APP_URL` (already exists if using the public
  Site URL — verify; otherwise add to backend `.env.example` so the
  invite URL builder has a base).

### Dependencies

T22 (leader role).

### Estimated complexity

Medium-large (collection-group transaction is the spicy bit). One
Sonnet session, ~1.5 days.

---

## T26 — Sticker reactions on messages — Sonnet

**Goal:** Members can react to a message with a sticker. Reaction counts are
denormalized via a Cloud Function and surface as a small bar beneath each
message.

### Acceptance criteria

- Reacting from one tab updates the bar in another tab within 2s
  (cold-starts excepted).
- Removing a reaction decrements the count; deleting the underlying message
  clears all reactions (cascade handled by the trigger).
- Rule tests confirm: clients cannot write `reactionCounts`; clients can
  only write their own `reactions/{stickerSlug}/users/{uid}` doc.
- The trigger handles double-delivery cleanly — a unit test fires the same
  `event.id` twice and asserts the counter advances by exactly one.
- A reaction from a muted/blocked user (T21) is hidden from the reactor's
  view in the bar (client-side filter).
- A reaction in an archived group (T23) is rejected by the rule.
- A reaction on a message that's hidden by T20 auto-moderation
  (`moderation.state == "hidden"`) is **allowed** — the author and viewers
  who clicked "Show anyway" can still react. The reaction bar shows on
  the placeholder.

### Files to create

- `frontend/components/chat/ReactionBar.tsx` — beneath each message;
  renders only stickers with `count > 0`, ordered by count desc; tap
  to toggle.
- `frontend/components/chat/ReactionPicker.tsx` — six-sticker picker;
  appears on hover (desktop) / long-press (mobile).
- `frontend/lib/hooks/useReactions.ts` — exposes `react(mid, slug)`
  and `unreact(mid, slug)`. Live `reactionCounts` come from
  `useGroupMessages` since they're denormalized onto the message
  doc; this hook is for *writes* + a small `myReactionsForMessage(mid)`
  side index that listens to `groups/{gid}/messages/{mid}/reactions/*/users/{currentUid}`.
- `functions/src/onReactionWrite.ts` — Firestore trigger on
  `groups/{gid}/messages/{mid}/reactions/{stickerSlug}/users/{uid}`.
  Pattern P3.
- `functions/src/__tests__/onReactionWrite.test.ts`.
- `firestore/tests/reactions.rules.test.ts`.

### Files to modify

- `firestore/firestore.rules` — add the reactions subcollection rules.
- `frontend/lib/hooks/useGroupMessages.ts` — extend `Message` type
  with `reactionCounts?: Record<string, number>`.
- `frontend/components/chat/MessageItem.tsx` — render
  `<ReactionBar />` below the body; render `<ReactionPicker />`
  inside the existing overflow row, gated on `!isDeleted` and
  `!archived`.
- `functions/src/index.ts` — export the new trigger.
- `firestore/firestore.indexes.json` — no new index (no compound
  query — count is read directly from the parent message).
- `docs/data-model.md` — document the new subcollection.

### Data model changes

```
groups/{gid}/messages/{mid}/reactions/{stickerSlug}/users/{uid}
  { reactedAt: Timestamp }

groups/{gid}/messages/{mid}.reactionCounts: { [stickerSlug]: number }
  // system-only; written by onReactionWrite.
```

The `reactions/{stickerSlug}/users/{uid}` shape — three layers — is
intentional: it lets us list per-sticker reactors cheaply (`users` is
a collection beneath each sticker), and the count is just `users`
size.

### Firestore rule deltas

Add the new rule block. **The
`groups/{gid}/messages/{mid}.reactionCounts` field gets locked on
the message-update rule.**

```
// Inside match /groups/{gid}/messages/{mid}:
allow update: if isGroupMember(gid) && notBanned() && (
  // … existing branches (edit, delete, announce) …
);
// reactionCounts is system-only; the existing onlyChanges() branches
// don't include it, so the rule already rejects client writes —
// confirmed by the rule's default-deny posture. Add a rules test.

match /groups/{gid}/messages/{mid}/reactions/{stickerSlug}/users/{uid} {
  // Members of the group can see who reacted with which sticker.
  allow read: if isGroupMember(gid);

  // Owner only, archived-group rejection, and the sticker slug must
  // exist. Reaction creation requires the message exists, is not
  // soft-deleted (so reactions can't pile up on a tombstone), and the
  // group is not archived.
  allow create: if isUser(uid) && notBanned()
    && isGroupMember(gid)
    && exists(/databases/$(database)/documents/stickers/$(stickerSlug))
    && get(/databases/$(database)/documents/groups/$(gid)).data.archivedAt == null
    && get(/databases/$(database)/documents/groups/$(gid)/messages/$(mid)).data.deletedAt == null
    && request.resource.data.keys().hasOnly(['reactedAt'])
    && request.resource.data.reactedAt == request.time;

  // Idempotent toggle off.
  allow delete: if isUser(uid) && notBanned();

  // No update — toggle is delete + create.
  allow update: if false;
}
```

(Three `get` calls per reaction-create. That's expensive; the
alternative is to hold the archived/deleted state on the parent
message itself with a denormalized field, but that's more drift than
we have appetite for. Document the cost in the ADR-equivalent
comment in the rules file.)

### Backend interface

None. Reactions are pure client-write + Cloud-Function fan-out.

### Frontend interface

- **Picker:** six-sticker grid (the seeded christian set). Hover (with
  150ms delay) → fade-in; mobile long-press (300ms) → bottom-sheet.
  Tap a sticker → toggle.
- **Bar:** small chips like `🙏 3`, `❤️ 1`. Tapping a chip the user
  has reacted with: removes their reaction; tapping a chip they
  haven't: adds.
- **My-reactions index:** `useReactions` listens to
  `users/{currentUid}` reactions across the visible message ids — but
  that's expensive. Decision: instead, listen at
  `collectionGroup('users')` filtered to `request.auth.uid` — but
  that crosses the membership boundary again. **Cleanest:** hold a
  per-message Set of "myReactedSlugs" inside `useReactions`, populated
  by reading `messages/{mid}/reactions/{slug}/users/{currentUid}` for
  each message in view (one read per visible message × number of
  stickers; throttle by listening only to messages currently rendered).
  Simpler: when the user reacts/unreacts, update local state
  optimistically; rely on the `reactionCounts` denormalization for
  global counts.

  **Final decision (sized for v1):** keep an in-memory Set keyed by
  `messageId+stickerSlug` populated optimistically on toggle. Rebuild
  on remount via a small one-shot read for messages currently
  rendered (not all messages). This is fine for chat feeds where
  visible window is ≤ 50 messages.

- **Mute/block filter:** the bar shows global counts (denormalized).
  Showing per-reactor names is a Phase 3 feature. So mute/block is
  *not* applied to counts — a muted user's reaction still counts.
  This is a deliberate decision (counts are public anyway since
  every member sees them, and per-user filtering would require
  reading all reactor docs). Call it out in the spec body.

### Cloud Functions

`functions/src/onReactionWrite.ts`:

- Trigger: `onDocumentWritten("groups/{gid}/messages/{mid}/reactions/{stickerSlug}/users/{uid}", ...)`.
- Region/options: P3 defaults.
- Logic:
  - `before.exists`, `after.exists` → compute `delta = after - before` (1 / -1 / 0).
  - In a transaction, idempotent on `event.id` (write to
    `messages/{mid}/_reaction_events/{eventId}`):
    `messages/{mid}.reactionCounts.<slug>` increment by delta.
  - Sentinel: if delta would drop count to 0, **leave the field as
    0 and don't delete**. (Map fields are cheap; deleting requires
    `FieldValue.delete()` and a separate code path. Counts of 0 are
    filtered client-side.)
- Cascade delete: a separate trigger
  `onMessageWrite.ts` handles soft-delete fan-out — extend it to also
  *not* clear reactions on soft-delete (reactions pile up but are
  hidden by the bar's "show only counts > 0" filter, and the message
  body is replaced with `[message removed]`). On hard-delete (which
  the rule forbids), the trigger logs a warning. A separate
  cleanup-on-hard-delete function is **out of scope**.

### Test plan

**Functions (`functions/src/__tests__/onReactionWrite.test.ts`):**
- `delta_is_+1_on_create`.
- `delta_is_-1_on_delete`.
- `delta_is_0_on_no_change`.
- `idempotent_under_double_delivery` — same eventId twice → count
  advances by 1.
- `failed_transaction_throws_for_observability`.

**Rules (`firestore/tests/reactions.rules.test.ts`):**
- `member can react`.
- `non-member cannot react`.
- `archived group: reaction rejected`.
- `deleted message: reaction rejected`.
- `unknown sticker slug: reaction rejected`.
- `cannot write to other user's reactions/users/{uid}`.
- `client cannot write reactionCounts on the parent`.
- `member can read reactions list`.

**Frontend (`frontend/tests/reactions.test.tsx`):**
- `picker shows six stickers and toggles on tap`.
- `bar renders only counts > 0`.
- `tapping own reaction calls deleteDoc`.
- `tapping new reaction calls setDoc with reactedAt`.

### Edge cases / gotchas

- **Sticker rename / retire (T06).** If a sticker is retired, its
  `reactions/{slug}/users/...` rows persist. The bar continues to
  render (looking up the sticker by slug — if it's retired, render
  the slug as a fallback label). Document this in the runbook.
- **Reactions on hidden (T20) messages.** Allowed by rule. The
  picker is rendered in the overflow row of `MessageItem`, which is
  hidden when `shouldHideBody` is true. Decision: still render the
  reaction *bar* for hidden messages — counts are public — but
  hide the *picker* until the user clicks "Show anyway". Then
  picker is enabled.
- **Reactions in an archived group.** Rejected by the rule. The
  picker is also hidden by `archived` prop in `MessageItem`. Verify
  both layers in tests.
- **Double-tap.** Two rapid taps → optimistic state flips twice;
  Firestore receives two writes. The trigger handles both in
  transaction. End state matches user intent.
- **Per-user "did I react" check.** `useReactions` does not realtime-listen to every user-reaction doc — too many listeners. It uses a one-shot read on initial render and optimistic updates after. A page refresh re-reads. This is the same trade-off as everywhere else where listener cost is the concern.
- **Mute/block.** Counts include reactions from muted/blocked users
  (call out: deliberate). Per-user reactor lists in Phase 3 will
  filter.
- **Counter drift.** P3's idempotency record is mandatory. Without
  it, at-least-once delivery means a reaction trigger could fire
  twice for the same toggle and the count would be off by ±1
  permanently.
- **Soft-delete clears `body` to `[message removed]` in the UI but
  leaves reactions intact**. Acceptable. Phase 3 may sweep them.

### Migration / rollout

None. New collection; no back-fill.

### Dependencies

T06 (stickers), T08 (messages), T20 (hidden state), T21 (mute/block —
client-side filter not applied to counts; documented).

### Estimated complexity

Medium (subcollection + trigger + picker UX). One Sonnet session, ~1.5 days.

---

## T27 — @mentions + mention notifications — Sonnet

**Goal:** Typing `@` in the message input opens an autocomplete of group
members. Sending a message with mentions persists `mentions: uid[]` on the
message doc and produces in-app notifications.

### Acceptance criteria

- Typing `@` in the input opens the dropdown filtered by displayName
  prefix; arrow keys move the selection; the inserted token references the
  right uid.
- A message with `@A` produces exactly one row in
  `users/A/notifications/`.
- A user mentioning themselves does not produce a self-notification.
- `mentions` array length > 10 is rejected by the rule.
- `mentions` referencing a non-member is rejected by the rule.
- A mention from a blocked user does not produce a notification (P7).
- A mention in an archived group still renders the chip but does not
  produce a notification (no fan-out).

### Files to create

- `frontend/components/chat/MentionInput.tsx` — wraps the existing
  `MessageInput` text input with `@`-autocomplete dropdown. Uses
  `react-mentions` or hand-rolled (decision below).
- `frontend/lib/mentions.ts` — pure helpers:
  - `parseMentionTokens(body: string): string[]` — extract tokens
    `@uid` (the on-wire shape).
  - `renderMentionsHTML(body, members): { html, mentionsList }` —
    swap `@uid` tokens for chip-styled spans.
  - `extractUidsFromBody(body): string[]` — for the rule-check
    pre-flight.
- `firestore/tests/mentions.rules.test.ts`.

### Files to modify

- `firestore/firestore.rules` — extend message create rule:
  - Add `mentions` to the keys allowlist.
  - Validate `mentions is list && size() <= 10`.
  - **Skip the per-uid existence check in the rule.** Rules can't
    iterate a list against `exists`. Instead, validate:
    - `mentions` is a list of strings, each ≤ 50 chars.
    - The array is the only optional field added.
    - The frontend pre-flight resolves uids; if a non-member sneaks
      through, the notification fan-out (which *can* check)
      silently drops them (logs `mention_invalid_uid`). This is
      a pragmatic compromise; document it.
  - **Acceptance criterion change:** "Mentions referencing a non-member
    are rejected by the rule" — *can't be done at rule layer* without
    a per-uid exists, which Firestore rules don't iterate. **Revise
    AC to "Mentions referencing a non-member do not produce a
    notification (silently dropped at fan-out)".** Confirm in test
    plan.
- `functions/src/onMessageCreate.ts` — extend at the bottom (after the
  moderation block) to read `mentions: string[]`, dedup against
  authorUid, look up each mentioned uid's
  `users/{uid}/blocks/{authorUid}` doc; if absent, write a
  notification (P7 shape, `kind: "mention"`).
- `frontend/components/chat/MessageInput.tsx` — replace its bare
  `<textarea>` with `<MentionInput>`. The `MessageInput` continues to
  own send / disabled / archived logic; `MentionInput` is purely the
  text composition layer.
- `frontend/components/chat/MessageItem.tsx` — render mentions: scan
  the body for `@uid` tokens, replace with chips that link to a
  profile preview (Phase 2 has no profile pages — link to
  `/profile/[uid]` placeholder; the page is a stub for v2).
- `docs/data-model.md` — `messages.mentions: string[]`.

### Data model changes

```
groups/{gid}/messages/{mid}.mentions: string[] | undefined
```

(undefined for legacy messages; rule treats absent and `[]` identically.
Test it.)

### Firestore rule deltas

In the message create predicate (after `mediaRefs`):

```
// T27 — mentions array (optional).
&& (!('mentions' in request.resource.data)
    || (request.resource.data.mentions is list
        && request.resource.data.mentions.size() <= 10))
```

Add `mentions` to the create-time allowlist
(`request.resource.data.keys().hasOnly([..., 'mentions'])`).

### Backend interface

None. The mention fan-out lives in the existing `onMessageCreate.ts`
function (alongside the T20 moderation logic). Backend stays out of
the hot path.

### Frontend interface

- **Decision: hand-roll the autocomplete** rather than pulling in
  `react-mentions` (last release was 2022; adds 30KB; we need only
  prefix-search). The hand-rolled version is ~150 LOC.
- **Trigger:** caret-position-aware. When the character before the
  caret is `@` (and we're not inside an open `@uid` token), open a
  dropdown anchored beneath the caret with `useCaretPosition` (small
  helper computing pixel offset from caret in the textarea).
- **Filter:** member list is `useGroup(gid).members` — but
  `useGroup` doesn't currently expose members; it should. Extend
  `useGroup` to optionally fetch members via a one-shot
  `getDocs(collection(...))` cached for 5 minutes (members rarely
  change). Or use the existing `members` collection directly via a
  fresh listener inside `MentionInput`.
  **Decision:** add a new `useMembers(gid)` hook with onSnapshot. It's
  used in T22's members page already (read inline there) — extract it.
- **Filtering:** prefix match on `displayName`, case-insensitive,
  excludes the current user, limited to 8 results.
- **Insertion:** the inserted on-screen text is `@<displayName>`
  (visual). The on-wire token is `@<uid>`. The transformer renders
  `@<uid>` → `@<displayName>` for display; the textarea internally
  stores the on-wire form (a `[uid]@displayName` representation).
  Implementation:
  - The textarea's `value` is the on-wire body (`@uid` tokens).
  - A `<div className="hidden">` mirror provides display rendering
    when the user previews. **Or:** simpler — the textarea holds the
    display text (`@<displayName>`); on send, we resolve back to
    uids via the in-memory member list. Risk: if a member's
    displayName is changed mid-compose, we resolve to whoever has
    that displayName *now*. Acceptable trade-off.
  - **Final:** display text in the textarea, resolve to uids on
    send. Same risk profile as Slack/Discord.
- **Rendering in feed:** scan the body for `@<displayName>` tokens
  using the *current* member map (T07's group). If a name resolves,
  link to `/profile/{uid}`; otherwise, render plain text. The
  `@` is part of the chip styling.
- **Self-mention:** Filter the autocomplete list to exclude the
  current uid. If the user types `@<theirOwnDisplayName>` manually,
  the chip renders but no notification fires.
- **Mute/block:** mention autocomplete excludes blocked users (the
  blocker can't @-summon someone they've blocked). Mute does not
  filter. Verify in tests.

### Cloud Functions

Extend `onMessageCreate.ts` at the very bottom (after the existing
moderation log line):

```ts
const mentions = (data.mentions as string[] | undefined) ?? [];
const dedupedMentions = [...new Set(mentions)].filter(
  (uid) => uid !== data.authorUid,
);
for (const recipientUid of dedupedMentions) {
  const blockSnap = await db
    .collection("users").doc(recipientUid)
    .collection("blocks").doc(data.authorUid as string)
    .get();
  if (blockSnap.exists) {
    logger.info("mention_blocked", { gid, mid, recipientUid });
    continue;
  }
  // Member existence check (silently drop non-members).
  const memberSnap = await db.collection("groups").doc(gid)
    .collection("members").doc(recipientUid).get();
  if (!memberSnap.exists) {
    logger.warn("mention_invalid_uid", { gid, mid, recipientUid });
    continue;
  }
  await db.collection("users").doc(recipientUid)
    .collection("notifications").add({
      kind: "mention",
      groupId: gid,
      messageRef: `groups/${gid}/messages/${mid}`,
      fromUid: data.authorUid,
      body: (data.body as string).slice(0, 200),
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
      deliveredAt: null,
      failedAt: null,
    });
}
```

The reads (one block doc + one member doc per mentioned user) are
synchronous in the trigger. With max 10 mentions per message, that's
20 reads — acceptable.

### Test plan

**Frontend (`frontend/tests/mentions.test.tsx`, new):**
- `typing @ opens dropdown of members`.
- `typing @al filters to displayName prefix al, case-insensitive`.
- `Enter inserts the selected member's chip`.
- `Self is excluded from autocomplete`.
- `Blocked users excluded from autocomplete`.
- `Esc closes the dropdown without inserting`.

**Rules (`firestore/tests/mentions.rules.test.ts`):**
- `message with mentions=[uid] is allowed`.
- `message with mentions of length 11 is denied`.
- `message with mentions=null is allowed (treats as empty)`.
- `message with non-list mentions is denied`.

**Functions (`functions/src/__tests__/mentionsFanout.test.ts`):**
- `mention to recipient writes notification doc`.
- `self-mention writes no doc`.
- `mention to blocker (recipient blocked author) writes no doc`.
- `mention to non-member writes no doc + logs mention_invalid_uid`.
- `multiple mentions write one doc per recipient (deduped)`.

### Edge cases / gotchas

- **Display-name resolution drift.** A user changes their
  displayName between when @-token was composed and when it's
  rendered. Detection: chip resolves on the current member's
  displayName at render time (always fresh). The tradeoff is the
  notification body preview is "@OldName … hi" if author saved an
  old reference. Accept.
- **Ambiguous displayName.** Two members named "Sam". Autocomplete
  shows both with avatar disambiguation. Insert picks the chosen
  uid; resolution at render is by uid.
- **Body limit (4000 chars).** Mention rendering doesn't expand the
  body; the on-wire body is unchanged. Phase 2 doesn't need a
  separate `body_html` field.
- **Notification flood from one message.** Cap `mentions` to 10
  (rule), but a message with 10 mentions still produces 10
  notifications. The digest (T35) batches; push (T34) sends N pushes
  unless the recipient throttles; T34 owns dedup by-recipient
  windows.
- **Edit a message to add a mention.** Currently message edit only
  allows `body` and `editedAt`. To allow mentions in edits we'd
  need to add `mentions` to the edit branch. **Decision: not for
  Phase 2.** A user who needs to mention someone in an edit
  re-posts the message. Document.
- **Rate limit.** No new rate limit; message create is rule-rate-limited
  by Firestore's per-second per-doc cap (effectively per-user via the
  rule's `notBanned + isMember` checks). Acceptable for v2.
- **Mention in announcement.** An announcement (T24) is just a
  pinned message; if it contains mentions, fan-out happens via the
  trigger. The mentioned user gets *both* an `announcement`
  notification (from T24's bulk write) *and* a `mention`
  notification (from the trigger). De-dup at the consumer side
  (T34/T35) by `(messageRef, recipientUid)` pair within a window:
  the second notification is skipped for push but kept for the
  inbox. Document in T34.

### Migration / rollout

None. Existing messages have no `mentions` field; that's fine.

### Dependencies

T08 (messages), T20 (this extends `onMessageCreate.ts`), T21
(mute/block), P7 (notifications collection from T24).

### Estimated complexity

Medium (autocomplete + fan-out extension). One Sonnet session, ~1 day.

---

## T28 — Full-text search sidecar (Typesense) — Opus

**Goal:** Members can search messages across their groups with
sub-second latency. Search index is a Typesense sidecar; a Cloud
Function fans Firestore writes; the backend proxies queries scoped to
the caller's memberships.

### Why Opus

This task crosses the per-group permission boundary that Phase 1's
rules carefully drew, introduces a new external dependency that has
to operate inside the same trust model as the rest of the stack, and
requires an ADR before code lands. Three judgment calls only an Opus
session should make:

1. **Vendor choice.** The plan placeholder lists Typesense Cloud,
   self-hosted Typesense on Cloud Run, and Algolia. The decision
   depends on a cost projection (rough math below) and the
   operational appetite for managing a stateful service. **Pre-decision
   for Sonnet's benefit:** Typesense Cloud, single-node M cluster
   at ~$70/month, encrypted at rest, single-region (us-east). If
   cost concerns dominate, fall back to self-hosted Typesense on
   Cloud Run with a 2GB persistent disk Cloud Storage volume — but
   that introduces a second stateful workload we have to back up.
   The ADR documents the chosen path.
2. **Authorization model.** The client cannot query Typesense
   directly — that bypasses the per-group rule. The backend
   enumerates the caller's group memberships and constrains the
   query with `filter_by: groupId:[g1,g2,...]`. Risk: a stale index
   for a group the user just left could leak a recent message. The
   trigger removes messages when the group is deleted, but groups
   *aren't* deleted in v2 (archived only). **Decision:** the
   filter list is computed *per-request* from the live `members`
   collection-group query. A user who left a group between two
   queries no longer sees its messages in the second.
3. **Index schema.** What about photos and stickers? **Decision:**
   index `body` (text), `stickerIds` (string array facet),
   `authorUid`, `authorDisplayName`, `groupId` (filter), `createdAt`
   (sortable int64), `parentMessageId` (filter for threads-vs-toplevel).
   No image OCR. The ADR captures schema versioning so we can
   rebuild on changes.

### Acceptance criteria

- A new message is searchable within 5 seconds in another tab
  (cold-starts excepted).
- A user not in group `g1` cannot retrieve a `g1` message via search,
  verified by an integration test against a non-member.
- Soft-delete: message disappears from search within 5s.
- Reindex script run against the dev project rebuilds the index from
  a fresh Typesense container; counts match Firestore counts within
  1%.
- ADR captures vendor, cost, and operational ownership.

### Files to create

- `docs/adr/0005-search-sidecar.md` — vendor choice, schema, ops.
  (T28 originally specced `0002`, but `0001` and `0003` already
  exist; renumber to the next free slot.)
- `functions/src/onMessageIndex.ts` — Firestore trigger on
  `groups/{gid}/messages/{mid}` create/update/delete; upserts/deletes
  from Typesense via REST.
- `functions/src/services/typesense.ts` — Typesense client wrapper
  (REST; avoids the SDK's heavyweight dependencies). Pattern P8
  circuit breaker.
- `backend/app/routers/search.py` — `GET /api/search?q=...`. Reads
  caller's memberships, dispatches to Typesense.
- `backend/app/services/search.py` — Typesense client, query builder,
  result normaliser.
- `backend/app/models/search.py` — `SearchResult`, `SearchResponse`.
- `frontend/components/search/SearchBar.tsx` — modal triggered by
  `Cmd-K` / `Ctrl-K` from the app shell.
- `frontend/app/search/page.tsx` — full-page results with pagination.
- `frontend/lib/hooks/useSearch.ts` — debounced query hook (300ms).
- `infra/scripts/reindex_messages.py` — full reindex.
- `infra/typesense.tf` — Terraform pulling the Typesense API key
  out of Secret Manager and exposing it to Cloud Run.

### Files to modify

- `backend/app/limits.py` — add `SEARCH_QUERY: str = "30/minute"`.
- `backend/app/main.py` — register the new router.
- `frontend/app/(authed)/layout.tsx` — register the global Cmd-K
  listener that opens the search modal.
- `firestore/firestore.indexes.json` — no change (search reads stay in
  Firestore at backend; no new client query needed).
- `docs/runbooks/search.md` — new runbook (Typesense outage, reindex,
  schema migration).
- `backend/.env.example`, `frontend/.env.example`,
  `functions/.env.example` (new — currently functions has none) —
  document `TYPESENSE_HOST`, `TYPESENSE_API_KEY` (admin and search
  variants), `TYPESENSE_COLLECTION = "messages"`.

### Data model changes

Typesense collection `messages` schema:

```json
{
  "name": "messages",
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "groupId", "type": "string", "facet": true },
    { "name": "authorUid", "type": "string", "facet": true },
    { "name": "authorDisplayName", "type": "string", "optional": true },
    { "name": "body", "type": "string" },
    { "name": "stickerIds", "type": "string[]", "facet": true, "optional": true },
    { "name": "createdAtUnix", "type": "int64" },
    { "name": "parentMessageId", "type": "string", "optional": true, "facet": true }
  ],
  "default_sorting_field": "createdAtUnix"
}
```

No Firestore schema changes.

### Firestore rule deltas

None directly. The search backend uses the Admin SDK (rule-bypass) to
read `members` for membership enumeration. Document in the ADR that
the `users/{uid}` read is rule-allowed (`allow read: if isSignedIn()`)
so the join enrichment is also fine.

### Backend interface

`GET /api/search?q=<string>&page=<int>&perPage=<int>`:

- **Auth:** any signed-in user.
- **Rate limit:** `SEARCH_QUERY` (30/min/uid).
- **Behavior:**
  1. Read caller's memberships:
     `db.collection_group("members").where("uid", "==", user.uid).limit(100)`.
     (100 cap; if a user is in >100 groups, we cut off the search.
     Document; rare in v2.) Resolve to `gids: list[str]`.
  2. Build Typesense query:
     ```
     filter_by: f"groupId:[{','.join(gids)}]"
     query_by: "body,authorDisplayName"
     sort_by: "createdAtUnix:desc"
     per_page: clamp(perPage, 1, 50)
     page: page
     q: <string>
     ```
  3. Run via `services/search.search(q, gids, page, per_page)`.
  4. Return `SearchResponse { hits: SearchResult[], total: int, page, perPage }`.
  5. **Hidden-by-moderation messages**: filter results where the hit's
     metadata indicates `moderation.state == "hidden"`. Two paths:
     (a) include `moderationState` in the index and filter
     `filter_by: moderationState:[!=hidden]`, or (b) re-fetch each
     hit's Firestore doc and filter server-side. Option (a) is
     cheaper; index `moderationState` and update on any moderation
     write. Pre-decided.
- **Pydantic:**
  ```python
  class SearchResult(BaseModel):
      messageRef: str          # "groups/g/messages/m"
      groupId: str
      authorUid: str
      authorDisplayName: str | None
      body: str                # snippet from highlight
      createdAt: str           # ISO
      parentMessageId: str | None
  class SearchResponse(BaseModel):
      hits: list[SearchResult]
      total: int
      page: int
      perPage: int
  ```
- **Errors:** 503 `search_unavailable` (circuit breaker open),
  400 `invalid_query` (q is empty / too long > 200 chars),
  429 (rate limit hit).

`backend/app/services/search.py`:

- Wraps Typesense REST.
- Circuit breaker + 30s timeout.
- `search(q, gids, page, per_page)` returns the Typesense JSON,
  normalised into `SearchResult` dataclasses.
- `health()` returns Typesense `/health` for the backend's `/health`
  composite check.

### Frontend interface

- **`SearchBar`:** modal that captures `Cmd-K` / `Ctrl-K`. Input
  + result list. Debounce 300ms; show 8 results inline; "View all"
  routes to `/search?q=...`.
- **`/search` page:** full-page results, pagination.
- **`useSearch(q, page)`:** debounced fetch to `/api/search`.
- **Result rendering:** snippet with `<mark>` highlighting on
  the matched substring (Typesense returns `highlight` per field;
  render via `dangerouslySetInnerHTML` after sanitizing — the
  snippet is *not* user-controlled HTML; it's wrapped in
  Typesense-injected `<mark>` only). Use `DOMPurify` with an
  allowlist of `mark`. Decision: add `dompurify` to the frontend
  deps (one new dep — small).
- **No client-side Typesense access.** Reinforce with an ESLint
  rule that flags any import of `typesense` from `frontend/`.
  (Implementable as a no-restricted-imports rule.)

### Cloud Functions

`functions/src/onMessageIndex.ts`:

- Trigger: `onDocumentWritten("groups/{gid}/messages/{mid}", ...)`.
- Pattern P3 region/options/idempotency. Idempotency key:
  `event.id` stored under
  `groups/{gid}/messages/{mid}/_index_events/{eventId}`.
- Logic:
  - Read `before` and `after`.
  - If after.exists and `after.deletedAt == null`: upsert into
    Typesense with all fields. Resolve `authorDisplayName` via
    `users/{authorUid}.displayName`.
  - If after.exists and `after.deletedAt != null`: delete from
    Typesense (tombstone removes from search).
  - If after does not exist (hard delete): delete from Typesense.
- Failures: P8 circuit breaker. Log
  `search_index_failed { eventId, gid, mid, error }`. Throw on error
  so Cloud Run shows the failure in the metrics dashboard.
- Cost: each event = 1 Typesense write. At even 1000 messages/day
  that's well within the included quota of any Typesense Cloud
  plan.

### Test plan

**Backend (`backend/tests/test_search.py`):**
- `test_search_filters_to_caller_memberships` — user in groups
  [g1, g2]; results from g3 not returned.
- `test_search_unauthenticated_returns_401`.
- `test_search_empty_query_returns_400`.
- `test_search_rate_limited_returns_429` — fire 31 requests in
  60s; assert 31st returns 429.
- `test_search_typesense_down_returns_503` — mock circuit open.
- `test_search_excludes_hidden_messages` — index a message with
  `moderationState=hidden`; assert it's filtered.

**Functions (`functions/src/__tests__/onMessageIndex.test.ts`):**
- `create event upserts to Typesense`.
- `soft-delete event removes from Typesense`.
- `idempotent under double delivery`.
- `circuit open: skips upsert, logs warn`.

**Frontend (`frontend/tests/search.test.tsx`):**
- `Cmd-K opens search modal`.
- `typing in modal debounces and calls /api/search after 300ms`.
- `result click navigates to messageRef path`.
- `XSS in body is sanitized` — pass a hit with `<script>`; assert
  it's not rendered as HTML.

**Reindex (`infra/scripts/reindex_messages.py`):**
- Script unit tests (pytest) covering pagination + idempotency.

### Edge cases / gotchas

- **Stale index for left groups.** Backend always re-enumerates
  memberships per request, so a left group's messages are filtered
  out. Document.
- **DisplayName drift.** The index stores
  `authorDisplayName` denormalized at write time. A user renaming
  themselves only updates the index for *new* messages. Decision:
  acceptable for v2; the displayed result links to the message,
  which renders the live name anyway.
- **Moderation state changes.** When a message transitions to
  `hidden` by T20, `onMessageCreate.ts` writes `moderation.state`
  via update. The index trigger sees an update and re-upserts
  (including the new `moderationState`). The `filter_by` excludes
  hidden. **Wait** — `onMessageIndex.ts` is a write trigger that
  fires on any update. Make sure it only re-upserts on relevant
  changes (body, mediaRefs, editedAt, deletedAt, moderation.state)
  to avoid unnecessary index churn. Pure helper `shouldReindex`.
- **Soft-delete vs hard-delete semantics.** Hard delete shouldn't
  exist (rule denies); a defensive trigger still handles it
  (deletes from index).
- **Reindex script idempotency.** Re-running the full reindex
  should converge to the same state. Use Typesense's `upsert` API.
- **API-key rotation.** Two keys: admin (write) and search
  (read-only). Admin key is in Secret Manager only; the backend
  uses search key for queries; the function uses admin key for
  writes.
- **Secret Manager wiring.** Add `typesense_admin_key` and
  `typesense_search_key` to Secret Manager via `infra/typesense.tf`.
  Cloud Run service env mounts `TYPESENSE_API_KEY` from the
  search key; the function uses `TYPESENSE_ADMIN_KEY` from the
  admin key.

### Migration / rollout

- One-shot `infra/scripts/reindex_messages.py`:
  - Iterate all groups (paginated).
  - For each, iterate top-level + thread messages where
    `deletedAt is null`. Upsert into Typesense in batches of 100.
  - Track progress in stdout for resumability (run inside a
    short-lived Cloud Run Job).
- New env vars: `TYPESENSE_HOST`, `TYPESENSE_ADMIN_KEY`,
  `TYPESENSE_API_KEY`, `TYPESENSE_COLLECTION` (default
  `messages`), `TYPESENSE_DAILY_QUERY_CAP` (default 100000),
  `TYPESENSE_DISABLED` kill-switch.
- Feature flag: `JACOB_SEARCH_ENABLED` env on backend; when false,
  endpoint returns `503 search_unavailable` with `code:"search_disabled"`.
  This lets us deploy the function (which writes to the index) and
  delay the user-facing endpoint until the index is warm.

### Dependencies

T07 (groups), T08 (messages), T22 (members has the `uid` field
required for the collection-group query — already shipped via M11
in T39's deferred work). If T39 hasn't shipped this collection-group
field by the time T28 starts, T28 must include the back-fill or
block on T39.

### Estimated complexity

Large (new external dependency, new ADR, dual-trigger logic). One
Opus session, ~2.5 days.

---

## T29 — Sticker analytics for leaders — Sonnet

**Goal:** Leaders see a weekly breakdown of sticker mix, top contributors,
and posting cadence in their group. Reads come from BigQuery, not Firestore
(daily lag is acceptable).

### Acceptance criteria

- Posting fresh messages today appears in the dashboard tomorrow.
- Non-leader members hitting `/groups/[gid]/analytics` are redirected to
  the chat (route guard) and the API returns 403 (backend test).
- Sticker mix percentages sum to 100 (within rounding) and match a
  hand-counted tally for a known week in the test fixture.
- BigQuery load is idempotent — running it twice for the same day produces
  the same row count.
- Runbook covers backfill and schema migration.

### Files to create

- `infra/scheduled/firestore_to_bigquery.py` — Cloud Scheduler-triggered
  Cloud Run Job that runs the daily Firestore export → BigQuery load.
  (Decision: don't use Dataflow — overkill at our scale. The
  `bq load` CLI is sufficient.)
- `infra/bigquery/views.sql` — three SQL views: `messages_daily`,
  `sticker_mix_weekly`, `top_contributors_weekly`. Plus the raw
  external table definition `messages_raw_external`.
- `backend/app/routers/analytics.py` — leader-or-admin analytics
  endpoint.
- `backend/app/services/analytics.py` — BigQuery client wrapper
  with cached results.
- `backend/app/models/analytics.py` — pydantic models for the
  dashboard payload.
- `frontend/app/groups/[gid]/analytics/page.tsx` — dashboard page.
- `frontend/components/analytics/StickerMixChart.tsx` — pie/donut.
- `frontend/components/analytics/ContributorList.tsx` — ranked list.
- `frontend/components/analytics/CadenceChart.tsx` — bar chart by day.
- `frontend/lib/hooks/useAnalytics.ts` — fetch + cache hook (SWR style).
- `infra/bigquery.tf` — dataset, table, IAM bindings.
- `docs/runbooks/bigquery-export.md` — backfill, view migration.

### Files to modify

- `backend/app/limits.py` — add `ANALYTICS_QUERY: str = "60/hour"`.
- `backend/app/main.py` — register the router.
- `infra/scheduler.tf` — add a third scheduler job
  `firestore-to-bigquery`, daily at 04:30 UTC.
- `infra/service_accounts.tf` — add `jacob-analytics` SA with
  `roles/bigquery.dataEditor` on the dataset and
  `roles/storage.objectViewer` on the backups bucket.
- `infra/README.md` — list the new SA.

### Data model changes

BigQuery dataset `jacob_analytics`:

- External table `messages_raw_external` over
  `gs://jacob-backups-{env}/daily/{YYYY-MM-DD}/all_namespaces/all_kinds/output-*`.
- Three views (`CREATE OR REPLACE`):
  - `messages_daily(groupId, day, count, distinctAuthorCount)`
  - `sticker_mix_weekly(groupId, weekStart, stickerSlug, count)`
  - `top_contributors_weekly(groupId, weekStart, authorUid, count)`

No Firestore changes.

### Firestore rule deltas

None. The export is server-side; the analytics router uses the
Admin SDK to verify membership/leader role.

### Backend interface

`GET /api/groups/{gid}/analytics?range=7d|30d`:

- **Auth:** P2 leader-or-admin gate.
- **Rate limit:** `ANALYTICS_QUERY`.
- **Response:**
  ```python
  class AnalyticsResponse(BaseModel):
      gid: str
      range: Literal["7d", "30d"]
      totalMessages: int
      stickerMix: list[StickerMixItem]   # [{ slug, count, percent }]
      topContributors: list[ContributorItem]
      cadenceByDay: list[CadencePoint]
      generatedAt: str
  ```
- **Behavior:**
  - Compute `dateFrom = today - range_days`.
  - Read each view, scoped to `WHERE groupId = @gid AND day >= @dateFrom`.
  - Cache the response per `(gid, range)` for 1h in-process
    (`functools.lru_cache` with TTL via custom wrapper).
  - Resolve `displayName` for top contributors via a `users/{uid}`
    bulk read (≤ 5 reads).
- **Errors:** `forbidden` (403), `group_not_found` (404),
  `not_yet_loaded` (503).

`backend/app/services/analytics.py`:
- BigQuery client. **Cost guardrail:** every query passes
  `query_job_config.maximum_bytes_billed = 10 * 1024**3`. Document
  in the runbook.

### Frontend interface

- **Route:** `/groups/[gid]/analytics`. Leader-only (route guard;
  reuses the redirect helper from T23).
- **Charts:** `recharts` (already common in Next; ~30KB).
- **Range toggle:** segmented control 7d / 30d.
- **Empty state:** "Quiet week — see you next Sunday" when total = 0.
- **Loading skeleton:** matches the layout for stable CLS.

### Cloud Functions

None.

### Test plan

**Backend (`backend/tests/test_analytics.py`):**
- `test_analytics_leader_happy_path`.
- `test_analytics_admin_happy_path`.
- `test_analytics_non_leader_returns_403`.
- `test_analytics_unauthenticated_returns_401`.
- `test_analytics_caches_within_ttl`.
- `test_analytics_sticker_mix_sums_to_100`.
- `test_analytics_handles_zero_messages`.

**Loader (`infra/scheduled/test_firestore_to_bigquery.py`):**
- `test_loader_idempotent` — run twice; row count unchanged.
- `test_loader_writes_partition` — `WRITE_TRUNCATE`.

**Frontend (`frontend/tests/analytics.test.tsx`):**
- `non-leader is redirected away from analytics`.
- `dashboard renders charts when data is loaded`.
- `range toggle calls API with new range`.
- `empty state renders when totalMessages === 0`.

### Edge cases / gotchas

- **Schema migration.** Adding a new field to `messages` requires
  re-running the loader so the external table picks it up.
- **`generatedAt` cache key.** Used by the frontend for
  `if-modified-since`; or skip — 1h Cloud Run cache is acceptable.
- **Cost.** Bytes scanned per query < 100MB at our volume. The
  10GiB cap is a safety net.
- **Daily lag.** Document explicitly. Today's data isn't visible
  until tomorrow's loader runs.
- **Group archival.** Archived groups still produce analytics —
  retrospective review is still useful.
- **Admin claim shortcut.** A platform admin can view any group's
  analytics. Document.
- **Loader time vs read time.** The 04:30 loader writes
  `messages_daily${YESTERDAY}`. UI shows "Includes through
  yyyy-mm-dd" timestamp.

### Migration / rollout

- Initial back-fill: run the loader for the last 30 days manually
  post-deploy. Document.
- New env vars: `BQ_ANALYTICS_DATASET = "jacob_analytics"`,
  `BQ_PROJECT` (defaults to `GOOGLE_CLOUD_PROJECT`).
- Feature flag: `JACOB_ANALYTICS_ENABLED` (returns 503
  `analytics_disabled` when off).

### Dependencies

T16 (Firestore export to GCS), T22 (leader role).

### Estimated complexity

Medium (loader + BigQuery + dashboard, mostly plumbing). 1.5 days.

---

## T30 — Group discovery page — Sonnet

**Goal:** Signed-in users browse public groups, filter, and request to
join — no out-of-band invite code required.

### Acceptance criteria

- Discovery list excludes private groups (rules test).
- Pagination works (50 per page, cursor-based).
- A user requesting to join a request-only group cannot read its
  messages until approved (rules test).
- A leader approving a join request adds the user to `members/` and
  writes an audit row.
- The `audience` filter renders correctly even when only one option
  exists today (forward-compat for Phase 3 BJJ).

### Files to create

- `frontend/app/discover/page.tsx` — discovery list page.
- `frontend/components/discover/GroupCard.tsx` — single card.
- `frontend/components/discover/DiscoverFilters.tsx` — audience +
  search + sort.
- `frontend/components/discover/JoinRequestButton.tsx` — request to
  join when group is request-only.
- `frontend/lib/hooks/useDiscoverGroups.ts` — paginated query hook.
- `backend/app/routers/discover.py` — server-side enrichment +
  join-request endpoints.
- `backend/app/models/discover.py` — `JoinRequest`, `JoinModeRequest`.
- `firestore/tests/discover.rules.test.ts`.

### Files to modify

- `firestore/firestore.rules`:
  - Widen `groups/{gid}` read: any signed-in user when
    `resource.data.isPrivate == false && resource.data.archivedAt == null`.
    Existing `isGroupMember(gid)` continues to apply.
  - Add new collection rule for
    `groups/{gid}/joinRequests/{uid}` — owner-create, leader-read,
    leader-update.
- `firestore/firestore.indexes.json` — composite index on
  `(isPrivate ASC, archivedAt ASC, memberCount DESC, createdAt DESC)`.
- `frontend/lib/hooks/useGroup.ts` — extend with
  `joinMode: "open" | "request"`.
- `docs/data-model.md` — `groups.joinMode`,
  `groups/{gid}/joinRequests/{uid}` collection.

### Data model changes

```
groups/{gid}.joinMode: "open" | "request"   // default "open"
groups/{gid}.audience: "christian" | "bjj" | "general"  // default "christian"

groups/{gid}/joinRequests/{uid}: {
  message: string,             // optional, ≤ 280 chars
  requestedAt: Timestamp,
  status: "pending" | "approved" | "rejected",
  reviewedAt: Timestamp | null,
  reviewedBy: string | null,
}
```

### Firestore rule deltas

```
match /groups/{gid} {
  allow read: if isGroupMember(gid)
              || (isSignedIn()
                  && resource.data.isPrivate == false);
  // … existing create/update/delete rules …
}

match /groups/{gid}/joinRequests/{uid} {
  allow read: if isUser(uid) || isGroupLeader(gid);
  allow create: if isUser(uid) && notBanned()
    && request.resource.data.keys().hasOnly(['message', 'requestedAt', 'status'])
    && request.resource.data.requestedAt == request.time
    && request.resource.data.status == "pending"
    && (request.resource.data.message is string
        && request.resource.data.message.size() <= 280);
  allow update: if isGroupLeader(gid) && notBanned()
    && onlyChanges(['status', 'reviewedAt', 'reviewedBy'])
    && request.resource.data.reviewedAt == request.time
    && request.resource.data.reviewedBy == request.auth.uid
    && request.resource.data.status in ['approved', 'rejected']
    && resource.data.status == "pending";
  allow delete: if isUser(uid) && resource.data.status == "pending";
}
```

(Archived groups can still be browsed publicly — needed for T31's
read-only feed.)

### Backend interface

| Method | Path                                       | Purpose |
|--------|--------------------------------------------|---------|
| GET    | `/api/discover/groups`                     | Paginated public list |
| POST   | `/api/groups/{gid}/join-requests`          | Create join request |
| GET    | `/api/groups/{gid}/join-requests`          | Leader: list pending |
| POST   | `/api/groups/{gid}/join-requests/{uid}/approve` | Leader |
| POST   | `/api/groups/{gid}/join-requests/{uid}/reject`  | Leader |

`GET /api/discover/groups`:
- Query: `audience`, `q`, `cursor`, `limit`.
- Returns `[{gid, name, description, memberCount, audience, joinMode, leaderUids[], stickerMixSnapshot}]`.
- `stickerMixSnapshot` from T29's `sticker_mix_weekly` view (top 3,
  trailing 7 days). If T29 not yet shipped, omit gracefully.

`POST /api/groups/{gid}/join-requests`:
- **Auth:** signed-in.
- **Rate limit:** `GROUP_JOIN`.
- **Body:** `{ message?: string }`.
- **Behavior:**
  - 404 if group missing.
  - 409 if user is already a member.
  - If `joinMode == "open"`: behave like T25 join transparently;
    return 200 with `joined: true`.
  - If `joinMode == "request"`: write
    `groups/{gid}/joinRequests/{uid}` with `status: "pending"`.
    Audit log `request_join`. Return 200 with `pending: true`.

`POST /api/groups/{gid}/join-requests/{uid}/approve`:
- **Auth:** leader.
- Transactionally: read request (must be pending), set
  status=approved, write `members/{uid}` with role member,
  increment `memberCount`. Audit log `approve_join_request`.

`POST /api/groups/{gid}/join-requests/{uid}/reject`:
- Symmetric. Audit log `reject_join_request`.

### Frontend interface

- **Route:** `/discover`. List + filters.
- **Filters:** audience radio, q text input (debounced 300ms),
  sort: memberCount desc / createdAt desc.
- **Card:** name, description, member count, leader avatars (top 3),
  sticker mix snapshot. CTA "Join" or "Request to join" depending on
  `joinMode`.
- **Hook:** `useDiscoverGroups` calls `GET /api/discover/groups`.
  Cursor-based pagination via "Load more" button.
- **Join requests management:** integrate into T23's settings page
  as a new tab. Leader sees pending requests with approve/reject
  buttons.

### Cloud Functions

None.

### Test plan

**Rules:**
- `signed-in user can read public group doc`.
- `signed-in user cannot read private group doc`.
- `signed-in user can read public group's join-request collection if owner`.
- `signed-in user cannot read other users' join-requests`.
- `leader can read all join-requests in their group`.
- `leader can flip status from pending to approved`.
- `leader cannot flip status of already-resolved request`.

**Backend:**
- `test_discover_lists_only_public`.
- `test_discover_audience_filter`.
- `test_discover_pagination_cursor`.
- `test_join_request_open_group_joins_directly`.
- `test_join_request_request_mode_writes_pending`.
- `test_approve_join_request_adds_member`.
- `test_approve_join_request_not_leader_returns_403`.

**Frontend:**
- `discover page renders cards`.
- `audience filter changes query`.
- `Join button calls join-request endpoint`.
- `Request to join button surfaces optional message field`.

### Edge cases / gotchas

- **Public group read while archived.** Allowed — so T31's
  read-only feed works. UI surfaces archive banner.
- **Banned user requests join.** `notBanned()` is in the rule;
  backend also rejects with 403.
- **User requests join twice.** Second is a no-op; returns 200 with
  the existing request id.
- **Leader changes joinMode.** Existing pending requests are not
  retroactively approved.
- **Discovery sort.** memberCount desc requires the composite
  index. Confirm in indexes.

### Migration / rollout

- Existing groups have no `joinMode` or `audience`. The hook reads
  `undefined` as `"open"` / `"christian"`.
- Add `audience: "christian"` to `groups/{gid}` create rule
  allowlist.
- New env vars: none.

### Dependencies

T07 (groups), T22 (leaders), T23 (settings page hosts the
join-request approvals tab), T29 optional.

### Estimated complexity

Medium. 1.5 days.

---

## T31 — Cross-group read-only chat browsing — Sonnet

**Goal:** A user browses the recent feed of any public group they're not
a member of, read-only.

### Acceptance criteria

- A non-member of a public group can read its top-level feed but cannot
  see threads.
- Reading a private group as a non-member is denied (rules test).
- Reply / React / Pin affordances do not render in read-only mode.
- Soft-deleted messages are not visible to non-members (rules test).

### Files to create

- `frontend/app/discover/[gid]/page.tsx` — read-only chat feed.

### Files to modify

- `firestore/firestore.rules` — widen the message read rule:
  ```
  allow read: if isGroupMember(gid)
              || (isSignedIn()
                  && get(/databases/$(database)/documents/groups/$(gid)).data.isPrivate == false
                  && resource.data.parentMessageId == null
                  && resource.data.deletedAt == null
                  && (resource.data.moderation == null
                      || resource.data.moderation.state != "hidden"));
  ```
- `frontend/components/chat/MessageList.tsx` — accept `readonly`;
  when true, do not render `<MessageInput>`, hide `<ReactionPicker>`,
  `<ReportButton>`, reply / edit / delete actions.
- `frontend/components/chat/MessageItem.tsx` — accept `readonly` and
  short-circuit the overflow row when set.

### Data model changes

None.

### Firestore rule deltas

(See above.) The rule's `get()` adds one read per message read for
non-members. Acceptable cost.

### Backend interface

None. Read-only feed is a pure Firestore listener.

### Frontend interface

- **Route:** `/discover/[gid]`. Renders chat feed in read-only mode.
  Header: "Read-only · Join group" with the same join button as
  discover.
- **No reactions picker.** Bar showing global counts is fine.

### Test plan

**Rules:**
- `non-member can read public group's top-level message`.
- `non-member cannot read public group's thread reply`.
- `non-member cannot read private group's message`.
- `non-member cannot read public group's soft-deleted message`.
- `non-member cannot read public group's hidden message`.

**Frontend:**
- `read-only page renders messages without input`.
- `reply / edit / delete buttons not rendered in readonly mode`.
- `reaction picker hidden in readonly mode`.

### Edge cases / gotchas

- **Listener cost.** `useGroupMessages` already tears down on
  unmount.
- **Photos.** Public-bucket URLs are world-readable.
- **Banned non-member.** `isSignedIn()` allows banned users to read.
  They can't write. Acceptable.
- **Mention chips link to `/profile/[uid]`.** Non-member can't
  follow them in v2.

### Migration / rollout

None.

### Dependencies

T08, T23 (archive surfaces), T30 (discovery is the entry point).

### Estimated complexity

Small (rule widening + readonly prop). Half a day.

---

## T32 — Cross-group message boards (forums) — Opus

**Goal:** A new top-level resource — message boards. Anyone signed in can
read and post; posts require a sticker tag like messages do. Used for
cross-group conversation that doesn't belong inside a single group.

### Why Opus

A new top-level collection means a new rule shape; the May 2026
review found that ad-hoc rule shapes drift. This task introduces:

1. A *globally* readable / writable space — failure mode is wider
   than a single group's blast radius.
2. A second host for the existing moderation pipeline (T20 is keyed
   on `groups/{gid}/messages/{mid}`; T32 needs the same logic on a
   different path).
3. A second set of mute/block / mention / reaction integrations —
   each requires re-validating the producer-side fan-out logic from
   T21/T26/T27.
4. The "board admin" notion. Pre-decided: boards reuse
   `isPlatformAdmin()` for create/destroy; per-board moderation
   uses the platform-wide queue. No new permission tier.

### Acceptance criteria

- Signed-in users can read every board, post to any board, and react.
- Signed-out users redirected to sign-in (route guard); rule denies
  anonymous writes.
- Text-moderation trigger fires on board posts the same way it fires
  on group messages (T20 test extended).
- Posts and replies are tombstoned when the author deletes their
  account (T14 + new path coverage).
- Rule tests cover: create as signed-in, edit as non-author (denied),
  delete as author, delete as admin, report (denied to client write —
  must go through T19).

### Files to create

- `firestore/firestore.rules` — new top-level `boards` rule block.
- `firestore/tests/boards.rules.test.ts`.
- `firestore/firestore.indexes.json` — board listing indexes.
- `backend/app/routers/boards.py` — admin-only board create/list/delete.
- `backend/app/models/board.py`.
- `backend/scripts/seed_boards.py` — seed initial boards.
- `frontend/app/boards/page.tsx`,
  `frontend/app/boards/[boardId]/page.tsx`,
  `frontend/app/boards/[boardId]/[postId]/page.tsx`.
- `frontend/components/boards/BoardCard.tsx`,
  `PostCard.tsx`, `ReplyList.tsx`, `NewPostForm.tsx`,
  `NewReplyForm.tsx`.
- `frontend/lib/hooks/useBoards.ts`, `useBoardPosts.ts`,
  `useBoardPost.ts`.
- `functions/src/onBoardPostCreate.ts` — moderation + mention fan-out.
- `functions/src/onBoardPostWrite.ts` — `replyCount` maintenance.
- `functions/src/onBoardReplyWrite.ts` — symmetric.
- `docs/data-model.md` — boards section.

### Files to modify

- `frontend/components/nav/PrimaryNav.tsx` — add a "Boards" link.
- `firestore/firestore.rules` — add `board_mention`, `board_reply`
  to allowed `kind` values for `users/{uid}/notifications/{nid}`.
- `functions/src/services/textModeration.ts` — already pure;
  re-export consistently.
- `functions/src/index.ts` — export the new triggers.
- `docs/moderation-pipeline.md` — extend with the boards path.

### Data model changes

```
boards/{boardId}: {
  name: string,                  // ≤ 80
  slug: string,                  // unique, lowercase kebab
  description: string,           // ≤ 500
  audience: "christian" | "general",
  createdAt: Timestamp,
  archivedAt: Timestamp | null,
  postCount: number,
  schemaVersion: 1
}

boards/{boardId}/posts/{postId}: {
  authorUid: string,
  body: string,                  // ≤ 4000
  stickerIds: string[],          // ≥ 1, ≤ 5
  mediaRefs: string[],           // ≤ 4
  createdAt: Timestamp,
  editedAt: Timestamp | null,
  deletedAt: Timestamp | null,
  pinnedAt: Timestamp | null,
  pinnedBy: string | null,
  mentions: string[],            // ≤ 10
  reactionCounts: { [slug]: number },
  replyCount: number,
  moderation?: ModerationFields
}

boards/{boardId}/posts/{postId}/replies/{replyId}: {
  authorUid, body, stickerIds, mediaRefs,
  createdAt, editedAt, deletedAt,
  mentions, moderation? — same constraints as posts
}
```

### Firestore rule deltas

(Snippet — full block in rules; aspects worth flagging.)

```
match /boards/{boardId} {
  allow read: if isSignedIn();
  allow create, update, delete: if false;

  match /posts/{postId} {
    allow read: if isSignedIn();
    allow create: if isSignedIn() && notBanned()
      && request.resource.data.keys().hasOnly([
           'authorUid','body','stickerIds','mediaRefs',
           'createdAt','editedAt','deletedAt',
           'mentions','reactionCounts','replyCount',
           'pinnedAt','pinnedBy'])
      && request.resource.data.authorUid == request.auth.uid
      && request.resource.data.createdAt == request.time
      && request.resource.data.editedAt == null
      && request.resource.data.deletedAt == null
      && request.resource.data.replyCount == 0
      && request.resource.data.body is string
      && request.resource.data.body.size() >= 1
      && request.resource.data.body.size() <= 4000
      && request.resource.data.stickerIds is list
      && request.resource.data.stickerIds.size() >= 1   // boards REQUIRE a sticker
      && request.resource.data.stickerIds.size() <= 5
      && request.resource.data.mediaRefs is list
      && request.resource.data.mediaRefs.size() <= 4
      && get(/databases/$(database)/documents/boards/$(boardId)).data.archivedAt == null
      && (!('mentions' in request.resource.data)
          || (request.resource.data.mentions is list
              && request.resource.data.mentions.size() <= 10))
      && (!('pinnedAt' in request.resource.data)
          || request.resource.data.pinnedAt == null)
      && request.resource.data.reactionCounts is map
      && request.resource.data.reactionCounts.size() == 0;

    allow update: if isSignedIn() && notBanned() && (
      // Author edits within 15 min.
      (resource.data.authorUid == request.auth.uid
        && onlyChanges(['body', 'editedAt'])
        && request.resource.data.editedAt == request.time
        && request.time < resource.data.createdAt + duration.value(15, 'm'))
      // Author or platform admin soft-delete.
      || ((resource.data.authorUid == request.auth.uid
            || (request.auth.token.admin == true))
        && onlyChanges(['deletedAt'])
        && request.resource.data.deletedAt == request.time
        && resource.data.deletedAt == null)
      // Platform admin pin / unpin.
      || (request.auth.token.admin == true
        && onlyChanges(['pinnedAt', 'pinnedBy'])
        && (
          (resource.data.pinnedAt == null
            && request.resource.data.pinnedAt == request.time
            && request.resource.data.pinnedBy == request.auth.uid)
          || (resource.data.pinnedAt != null
            && request.resource.data.pinnedAt == null
            && request.resource.data.pinnedBy == null)
        ))
    );
    allow delete: if false;

    // … reply subcollection mirrors posts but no pinning, no replyCount …
    // … reactions subcollection mirrors T26's pattern …
  }
}
```

(Boards intentionally require **at least one sticker**. Group chat
doesn't, but boards do — the sticker tag is the only categorisation.)

### Backend interface

| Method | Path                 | Purpose |
|--------|----------------------|---------|
| GET    | `/api/boards`        | Public list |
| POST   | `/api/admin/boards`  | Admin create |
| DELETE | `/api/admin/boards/{boardId}` | Admin archive |
| POST   | `/api/admin/boards/{boardId}/posts/{postId}/pin` | Admin pin |

`POST /api/admin/boards`:
- Body: `name`, `slug`, `description`, `audience`.
- Reject if slug collision. Audit log `create_board`.

`DELETE /api/admin/boards/{boardId}`:
- Soft-archive: `archivedAt = SERVER_TIMESTAMP`. Audit log
  `archive_board`.

### Frontend interface

- **Route:** `/boards` — list of boards.
- **Route:** `/boards/[boardId]` — paginated post list, sorted by
  `pinnedAt desc, createdAt desc`. New post form at top.
- **Route:** `/boards/[boardId]/[postId]` — single post + replies.
- **Hooks:**
  - `useBoards()` — listens to `boards`, sorted by name.
  - `useBoardPosts(boardId)` — paginated, ordered by createdAt;
    pinned-first via client-side sort.
  - `useBoardPost(boardId, postId)` — post + replies (two
    listeners).
- **NewPostForm:** body, stickerIds (≥ 1), optional mediaRefs.
  Uses moderated upload pipeline P5 with `purpose: "board_post"`.
- **Reactions / mentions:** parameterise the components (T26 / T27)
  to accept either a group-message path or a board-post path.
  Define a `MessageRef` type and have the components dispatch.

### Cloud Functions

`functions/src/onBoardPostCreate.ts`:
- Mirrors `onMessageCreate.ts`. Reuses `services/textModeration.ts`.
- Mention fan-out: extract `fanOutMentions(...)` helper from
  `onMessageCreate.ts`. Tweak to accept a callback for
  member-resolution: pass `() => true` for boards.
- Notification `kind`: `"board_mention"`.

`functions/src/onBoardPostWrite.ts` and
`functions/src/onBoardReplyWrite.ts`:
- Maintain `replyCount` on the parent post when replies are
  created/soft-deleted. P3 idempotency.

### Test plan

Standard: rules tests cover anonymous denial, member denial of
`reactionCounts` write, archived board denial, missing sticker tag
denial. Backend tests for admin-only board creation. Frontend tests
for new post composition + listing.

### Edge cases / gotchas

- **No "leader" role on boards.** Pinning and archiving are admin
  actions. Board admin custom claim deliberately not introduced.
- **Posts independent of group archival.** Boards are independent
  of any group.
- **Stickers required on posts, optional on replies.** Captured in
  rule.
- **Mention fan-out skip.** Boards have no membership; skip the
  member-check shortcut. Block-check still applies.
- **Photo uploads on board posts.** Reuse moderated upload (P5)
  with `purpose: "board_post"`. Membership check inside
  `create_photo_upload` is bypassed for this purpose.
- **Search index integration.** Out of scope for v2; T28 indexes
  `groups/{gid}/messages/{mid}`. Boards aren't searchable. Document.
- **Sticker counts in analytics.** T29 reads `messages_daily`. Boards
  aren't aggregated. Phase 3.

### Migration / rollout

- Initial seed: `backend/scripts/seed_boards.py` creates "Prayer &
  praise", "Resources", "Events".
- New env vars: none.
- Feature flag: `JACOB_BOARDS_ENABLED`.

### Dependencies

T02, T06, T20, T21, T26, T27.

### Estimated complexity

Large. Opus session, ~3 days.

---

## T33 — Bible verse feed (daily, automated) — Sonnet

**Goal:** Authed home page shows a daily Bible verse, fetched from a
public-domain API and cached in Firestore. Liturgical calendar can override.

### Acceptance criteria

- Job populates today's verse by 07:30 UTC daily for 7 consecutive days
  in dev.
- Home page renders today's verse without an additional network call
  (Firestore listener — single read).
- Liturgical override: a calendar entry for `2026-04-05` (sample Lent
  date) renders that override.
- Job idempotency: running the job twice on the same day overwrites
  only the same doc.

### Files to create

- `infra/scheduled/daily_verse.py` — Cloud Run Job triggered daily
  at 07:00 UTC.
- `backend/app/services/verse.py` — wraps `bible-api.com` (KJV/WEB)
  with retry + circuit breaker (P8).
- `frontend/components/home/DailyVerse.tsx` — renders today's verse.
- `frontend/lib/hooks/useDailyVerse.ts` — listens to
  `daily_verse/{YYYY-MM-DD}`.
- `infra/seed/verse_calendar.json` — 365 references + liturgical
  overrides.
- `firestore/tests/dailyVerse.rules.test.ts`.

### Files to modify

- `firestore/firestore.rules` — new top-level `daily_verse/{day}`
  rule (read for any signed-in, write Admin SDK only).
- `infra/scheduler.tf` — add job entry.
- `frontend/app/(authed)/home/page.tsx` — render `<DailyVerse />`.
- `docs/data-model.md` — `daily_verse` collection.

### Data model changes

```
daily_verse/{YYYY-MM-DD}: {
  reference: string,           // "John 15:1"
  translation: "WEB" | "KJV",
  text: string,                // ≤ 2000 chars
  source: "bible-api.com" | "calendar-override",
  fetchedAt: Timestamp,
}
```

### Firestore rule deltas

```
match /daily_verse/{day} {
  allow read: if isSignedIn();
  allow create, update, delete: if false;
}
```

### Backend interface

None at the API. The verse service is invoked by the Cloud Run Job.

`backend/app/services/verse.py`:
- `fetch_verse_for_today() -> VerseDoc`:
  - Read today's date in UTC.
  - Look up `verse_calendar.json[today]`.
  - Otherwise rotate: `rotation[date.day_of_year % 365]`.
  - Call `bible-api.com/{reference}?translation=web`. Retry 3x with
    backoff. Circuit breaker P8.
  - Return `{reference, text, translation, source}`.
- `infra/scheduled/daily_verse.py`:
  - Call `fetch_verse_for_today()`.
  - Write `daily_verse/{YYYY-MM-DD}` with `merge=False` (overwrite).
  - Log `daily_verse_written`.
  - Sentry capture on failure.

### Frontend interface

- `<DailyVerse />` listens to `daily_verse/{today}`. Loading: skeleton.
  Missing: "A new verse will appear shortly." Else: reference + text
  in italic.
- Hook: `useDailyVerse()` returns `{verse, loading}`.

### Cloud Functions

None. Cloud Run Job, not Firebase Function.

### Test plan

**Backend (`backend/tests/test_verse.py`):**
- `test_fetch_verse_calendar_override`.
- `test_fetch_verse_rotation`.
- `test_fetch_verse_api_failure_circuit_opens` — 5 mock failures.
- `test_write_verse_idempotent`.

**Frontend:**
- `daily verse renders reference and text`.
- `placeholder shown when doc missing`.
- `external link is rel="noopener noreferrer"`.

**Rules:**
- `signed-in user can read daily verse`.
- `client cannot create daily verse`.

### Edge cases / gotchas

- **Date math.** UTC; per-user TZ is Phase 3.
- **Verse longer than 2000 chars.** Calendar should reference single
  verses. Validate at seed time.
- **Translation upgrade.** WEB is public domain. Switching is a
  separate task.
- **Sanitization.** Use `<p>`, not `dangerouslySetInnerHTML`.
- **Circuit-open day.** API down → no doc written → frontend shows
  placeholder. Sentry captures.

### Migration / rollout

- Back-fill the prior 7 days at deploy time.
- New env vars: `BIBLE_API_BASE = "https://bible-api.com"`,
  `JACOB_VERSE_TRANSLATION = "web"`, `JACOB_VERSE_DISABLED`.

### Dependencies

T11 (auth).

### Estimated complexity

Small. Half a day.

---

## T34 — Web push notifications via FCM — Sonnet

**Goal:** Members receive a web push notification for thread replies in
threads they posted in, for `@mentions`, and for announcements.

### Acceptance criteria

- Posting a reply in a thread user A previously replied in surfaces a push
  notification on user A's device within 10s.
- A user with mentions disabled does not get a mention push.
- Token cleanup runs and removes stale device docs in dev.
- Firefox + Safari support is documented.
- Sentry captures FCM send failures with the device id (no PII).

### Files to create

- `frontend/public/firebase-messaging-sw.js` — service worker.
- `frontend/lib/push.ts` — token registration, permission UX.
- `frontend/lib/hooks/usePushSetup.ts`.
- `frontend/components/nav/PushPrompt.tsx` — opt-in banner.
- `frontend/app/(authed)/settings/notifications/page.tsx` — toggles.
- `functions/src/onNotificationCreate.ts` — Firestore trigger that
  reads recipient prefs/devices and dispatches FCM.
- `functions/src/services/fcm.ts` — Admin SDK FCM wrapper with P8
  circuit breaker.
- `infra/scheduled/cleanup_stale_devices.py` — daily Cloud Run Job
  pruning `users/{uid}/devices/{deviceId}` where
  `lastSeenAt > 60d`.
- `firestore/tests/devices.rules.test.ts`.
- `docs/runbooks/push.md`.

### Files to modify

- `firestore/firestore.rules`:
  - `users/{uid}/devices/{deviceId}` — owner-only.
  - `users/{uid}/notificationPrefs/main` — owner-only with fixed
    keyset.
- `frontend/app/(authed)/layout.tsx` — register SW; show enrollment
  banner.
- `frontend/.env.example`, `frontend/README.md` —
  `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
- `infra/service_accounts.tf` — extend `jacob-functions` SA with
  `roles/firebasecloudmessaging.messageSender`.
- `docs/data-model.md` — `users/{uid}/devices`,
  `users/{uid}/notificationPrefs`.

### Data model changes

```
users/{uid}/devices/{deviceId}: {
  fcmToken: string,
  platform: "web" | "ios" | "android",
  createdAt: Timestamp,
  lastSeenAt: Timestamp,
  userAgent: string,
  appVersion: string | null,
}

users/{uid}/notificationPrefs/main:
{
  mentions: boolean,
  replies: boolean,
  announcements: boolean,
  digest: boolean,
  schemaVersion: 1
}
```

### Firestore rule deltas

```
match /users/{uid}/devices/{deviceId} {
  allow read, write: if isUser(uid)
    && request.resource.data.keys().hasOnly([
         'fcmToken','platform','createdAt','lastSeenAt',
         'userAgent','appVersion'])
    && request.resource.data.fcmToken is string
    && request.resource.data.fcmToken.size() <= 4096
    && request.resource.data.platform in ['web','ios','android']
    && request.resource.data.userAgent is string
    && request.resource.data.userAgent.size() <= 256;
  allow delete: if isUser(uid) || (request.auth.token.admin == true);
}
match /users/{uid}/notificationPrefs/{docId} {
  allow read: if isUser(uid);
  allow create, update: if isUser(uid)
    && docId == "main"
    && request.resource.data.keys().hasOnly([
         'mentions','replies','announcements','digest','schemaVersion'])
    && request.resource.data.mentions is bool
    && request.resource.data.replies is bool
    && request.resource.data.announcements is bool
    && request.resource.data.digest is bool;
  allow delete: if false;
}
```

### Backend interface

None.

### Frontend interface

- **`<PushPrompt />`:** banner on home page on first authed visit.
  Skip → 7-day snooze (localStorage flag).
- **`/settings/notifications`:** four toggles. Direct Firestore
  write to `users/{uid}/notificationPrefs/main`.
- **Token registration (`lib/push.ts`):**
  - Register service worker.
  - Request notification permission.
  - `getToken(messaging, { vapidKey })`.
  - Write `users/{currentUid}/devices/{deviceId}` where
    `deviceId = sha256(fcmToken)[:16]`. Update `lastSeenAt` on
    every authed page load (debounced once/hour/session).

### Cloud Functions

`functions/src/onNotificationCreate.ts`:
- Trigger: `onDocumentCreated("users/{uid}/notifications/{nid}", ...)`.
- P3 region/options.
- Logic:
  - Read `users/{uid}/notificationPrefs/main`.
  - Honor `kind`: skip when the relevant pref is false.
  - Read all `users/{uid}/devices`.
  - For each, send FCM via `services/fcm.send(token, payload)`.
  - On send success: update notification with `deliveredAt`.
  - On send failure: update with `failedAt`, `failureReason`.
  - Stale token detection: on
    `messaging/registration-token-not-registered`, delete the device
    doc.
- Idempotency: notification creation fires once. Retried delivery
  re-sends (FCM dedups within 4h by `collapse_key`).
- Circuit breaker: P8.
- Daily cap: P8 (`FCM_DAILY_CAP`, default 100k).

`functions/src/onMessageWrite.ts` — extend at the bottom of the
"create" branch to fan out reply notifications to participants minus
the author. Honors P7 block-check.

### Test plan

**Functions:**
- `notification create with prefs.mentions=false → no FCM call`.
- `notification create with prefs.mentions=true → FCM dispatched per device`.
- `unregistered-token error deletes device doc`.
- `circuit open: skips FCM, sets failedAt with reason="circuit_open"`.

**Frontend:**
- `push prompt shows on first authed visit`.
- `prompt skip writes localStorage flag`.
- `notifications page renders four toggles`.
- `toggle write updates Firestore prefs`.

**Rules:**
- `owner can read/write own devices`.
- `non-owner cannot read others' devices`.
- `notificationPrefs write rejected with extra keys`.

### Edge cases / gotchas

- **Safari quirks.** Safari requires user gesture for permission;
  Safari 16+ uses APNs for web push. Document.
- **iOS PWA limitations.** iOS 16.4+ supports web push only when
  installed to home screen. Banner copy mentions this.
- **Token rotation.** Compare last-known token; update doc if changed.
- **Multiple devices per uid.** Loop over all; FCM `collapse_key`
  handles per-device dedup.
- **Mention + announcement on same message.** T27 dedup at trigger:
  if user already has a notification with same `messageRef` and
  `kind == "announcement"` within 60s, skip the mention. Document.
- **Privacy.** Don't include body beyond 100-char preview in the
  FCM `data` payload. Don't include uids in title.
- **Retry budget.** P3 says retry: false. At-least-once Firestore
  delivery handles this.

### Migration / rollout

- `users/{uid}/notificationPrefs/main` is created lazily on first
  sign-in after this lands (via `usePushSetup`). Default all-true.
- Stale-device cleanup runs daily.
- New env vars: `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, `FCM_DAILY_CAP`,
  `FCM_DISABLED`.

### Dependencies

T05, T08, T09, T24, T27. P7.

### Estimated complexity

Large. 2 days.

---

## T35 — Weekly email digest with one-click unsubscribe — Sonnet

**Goal:** Every member with email opted in receives a weekly digest
summarizing activity in their groups. RFC 8058 one-click unsubscribe.

### Acceptance criteria

- Job sends to a SendGrid sandbox key for 100 fake users in under 5
  minutes.
- Unsubscribe link flips `notificationPrefs.digest` to false; subsequent
  runs skip the user.
- `List-Unsubscribe` header is set; Gmail's "Unsubscribe" button is shown
  (verified by sending one to a real Gmail in dev).
- Digest body shows zero rows for a user whose groups had no activity
  (the email still sends but says "Quiet week — see you next Sunday").

### Files to create

- `infra/scheduled/weekly_digest.py` — Cloud Run Job, Sundays
  16:00 UTC.
- `backend/app/services/digest.py` — assembles per-user payload from
  T29's BigQuery views + the user's group list.
- `backend/app/templates/email/weekly_digest.html.j2`,
  `weekly_digest.txt.j2` — digest templates.
- `backend/app/routers/account.py` — extend with
  `GET /api/unsubscribe?token=...`.
- `backend/app/services/unsubscribe.py` — JWT-signed token mint and
  verify (no DB read on unsubscribe — token contains uid + kind).

### Files to modify

- `backend/app/services/email.py` — extend with
  `send_weekly_digest(to, payload, unsub_token)` helper.
- `backend/app/config.py` — add `JWT_UNSUBSCRIBE_SECRET` setting
  (Secret Manager).
- `infra/scheduler.tf` — add weekly job at Sunday 16:00 UTC.
- `infra/service_accounts.tf` — add SA permission to call SendGrid
  (no GCP IAM; just network).
- `docs/data-model.md` — note the `notificationPrefs.digest` semantics.

### Data model changes

None new; reuses `users/{uid}/notificationPrefs/main.digest`
(boolean) introduced in T34. The digest job iterates users where
`digest == true`.

### Firestore rule deltas

None. The unsubscribe endpoint uses the Admin SDK to write
`notificationPrefs/main`.

### Backend interface

`GET /api/unsubscribe?token=<jwt>`:
- **Auth:** none. The token is the auth.
- **Behavior:**
  - Verify token (HS256, JWT_UNSUBSCRIBE_SECRET, 90-day expiry).
  - Extract `{uid, kind}`. Currently only `kind=digest`.
  - Update `users/{uid}/notificationPrefs/main.{kind}` to false.
  - Return a tiny HTML page: "You've been unsubscribed from
    weekly digests." Optionally a "Resubscribe" link that signs in
    and flips it back.
- **Errors:** 400 `invalid_token`.
- **Rate limit:** none (unsubscribe is a critical surface; let
  abusive replays be idempotent).

`backend/app/services/digest.py`:
- `assemble_user_payload(uid) -> DigestPayload`:
  - Read user's memberships via the collection-group query.
  - For each group, query T29's views for the trailing 7 days.
  - Sum: `top 3 stickers across all my groups`, `count of replies
    missed`, `count of new members across my groups`,
    `today's verse` (read `daily_verse/<today>`).
  - Return `{topStickers: [...], missedReplies: int,
            newMembers: int, todayVerse: VerseRef, groups: GroupSummary[]}`.
- `mint_unsubscribe_token(uid, kind) -> str`:
  - JWT(payload={uid, kind, exp=now+90d}, key=secret).

### Frontend interface

- **`/unsubscribe?token=...`:** static success page (no auth flow).
  Render via FastAPI HTMLResponse — keeps the unsubscribe surface in
  the trusted backend, not the frontend (the link must work on a
  device with no current session). The HTML is minimal Tailwind via
  `backend/app/templates/web/unsubscribe.html.j2`.

### Cloud Functions

None. Cloud Run Job.

### Test plan

**Backend (`backend/tests/test_digest.py`):**
- `test_assemble_payload_user_with_groups`.
- `test_assemble_payload_user_with_zero_activity` — payload has the
  "quiet week" flag.
- `test_unsubscribe_token_round_trip` — mint, verify.
- `test_unsubscribe_token_expired_returns_400`.
- `test_unsubscribe_idempotent` — call twice with same token; second
  call still returns 200.

**Job (`infra/scheduled/test_weekly_digest.py`):**
- `test_job_skips_users_with_digest_false`.
- `test_job_batches_at_200_with_1s_sleep`.
- `test_job_handles_sendgrid_500_via_retry` — mock 500; verify retry
  with backoff.
- `test_job_writes_audit_for_failures` — mock final-failure; assert
  audit row + Sentry capture.

**Frontend:** none (the unsubscribe page is server-rendered).

### Edge cases / gotchas

- **Local time approximation.** Phase 2: Sunday 16:00 UTC for
  everyone. Document that per-tz is Phase 3.
- **Sandbox vs prod SendGrid.** CI uses SendGrid sandbox key (no
  actual sends); dev sets `SENDGRID_SANDBOX=true`. Document.
- **Digest empty for archived-only memberships.** Skip groups
  whose `archivedAt > 60d` from the user's payload.
- **Unsubscribe token leakage.** The token is in the email body and
  `List-Unsubscribe` header; treat as semi-secret. Embed only `uid`
  and `kind`, not email. Document.
- **JWT secret rotation.** When the secret rotates, prior tokens
  become invalid. Acceptable; users re-receive a digest with a
  fresh token.
- **List-Unsubscribe header.** Both `mailto:unsubscribe-...@jacob.app`
  and `https://api.jacob.app/api/unsubscribe?token=...` should be
  present. RFC 8058 requires both for one-click compliance.
- **Gmail spam triggers.** Use SendGrid's domain authentication.
  Configure DKIM + SPF in DNS. Document in the runbook.
- **Holiday off-by-one.** No special handling.
- **Digest rendering when T29 hasn't shipped.** The job depends on
  BigQuery views. If they don't exist, the job logs `digest_disabled`
  and exits cleanly. Feature-flag via `JACOB_DIGEST_ENABLED`.

### Migration / rollout

- Feature flag: `JACOB_DIGEST_ENABLED`.
- New env vars: `JWT_UNSUBSCRIBE_SECRET` (Secret Manager),
  `SENDGRID_SANDBOX` (default false), `DIGEST_BATCH_SIZE = 200`.
- One-shot test send to a known dev account before enabling for
  pilots.

### Dependencies

T08, T18 (SendGrid), T29 (BigQuery views).

### Estimated complexity

Medium. 1.5 days.

---

## T36 — PWA install + offline shell + cached recent messages — Sonnet

**Goal:** JACOB is installable as a PWA. The app shell loads offline.
The active group's last 50 messages are available read-only without
network.

### Acceptance criteria

- App loads offline after one online visit (Lighthouse PWA score ≥ 90).
- Last 50 messages of active group remain visible offline.
- Sign-out clears IndexedDB (verified in a test).
- Install prompt does not reappear after dismissal.
- Service worker is unregistered cleanly during `npm run dev` if
  `NEXT_PUBLIC_DISABLE_SW=true`.

### Files to create

- `frontend/public/manifest.webmanifest` — PWA manifest with name,
  icons, start_url, display.
- `frontend/public/icons/` — 192x192, 512x512, 192x192 maskable,
  512x512 maskable. Generate from existing brand assets.
- `frontend/app/sw.ts` — service worker source. Decision:
  hand-rolled, no `next-pwa`. `next-pwa` is unmaintained for App
  Router; hand-roll is ~120 LOC.
- `frontend/lib/offline-cache.ts` — IndexedDB wrapper for messages
  (Dexie or hand-rolled — decision: Dexie for ergonomics; ~30KB).
- `frontend/components/nav/InstallPrompt.tsx` — install banner.
- `frontend/lib/hooks/usePWAInstall.ts` — captures `beforeinstallprompt`
  event, exposes `promptInstall()` + dismiss.
- `frontend/tests/offline.test.tsx` — vitest with fake IndexedDB.

### Files to modify

- `frontend/app/layout.tsx` — add `<link rel="manifest" />`.
- `frontend/app/(authed)/layout.tsx` — register the service worker
  on mount; mount `<InstallPrompt />`.
- `frontend/components/chat/MessageList.tsx` — fall back to cached
  snapshot when Firestore listener errors with offline.
- `frontend/lib/auth-context.tsx` — clear IndexedDB on sign-out.
- `frontend/.env.example`, `frontend/README.md` —
  `NEXT_PUBLIC_DISABLE_SW` (default unset).
- `next.config.js` — copy `sw.ts` into `public` at build time
  (Next plugin or post-build script). Decision: post-build script
  (`scripts/build-sw.ts` runs `tsc` against `app/sw.ts` and emits
  `public/sw.js`).

### Data model changes

IndexedDB-only; no Firestore changes.

```ts
// IndexedDB store "recentMessages":
{
  cacheKey: "<gid>",   // primary key
  messages: Message[], // last 50, sorted createdAt asc
  cachedAt: number,    // ms epoch
}
```

### Firestore rule deltas

None.

### Backend interface

None.

### Frontend interface

- **Service worker:**
  - On `install`: precache app shell (HTML, JS chunks, fonts, CSS).
  - On `activate`: claim clients.
  - On `fetch`: stale-while-revalidate for shell; passthrough for
    Firestore SDK calls (the SDK has its own offline queue —
    don't double-cache); passthrough for `/api/*` (network-only).
- **Install prompt:** captures `beforeinstallprompt` event. Banner
  shown on home page on first authed visit (post-T34 push prompt;
  the two banners stack vertically with priority push > install).
  Skip → 30-day snooze (localStorage).
- **Offline cache for messages:**
  - `useGroupMessages` listener fires; on each snapshot, write
    the last 50 to IndexedDB keyed by `gid`.
  - On listener error (offline detected), the hook returns the
    cached array with `offline: true`.
  - `MessageList` shows banner: "Offline — showing your last loaded
    messages."
- **Sign-out:** clear IndexedDB (`indexedDB.deleteDatabase("jacob-cache")`).

### Cloud Functions

None.

### Test plan

**Frontend:**
- `service worker registers on first authed visit`.
- `cache hit returns cached messages when offline detected`.
- `sign-out clears IndexedDB` (use `fake-indexeddb`).
- `install prompt does not reappear after dismissal` (localStorage
  flag).
- `service worker unregisters when NEXT_PUBLIC_DISABLE_SW=true`.

**Manual / Lighthouse:** PWA score ≥ 90 in CI via
`@lhci/cli`. Add a CI job that runs Lighthouse against a build
preview.

### Edge cases / gotchas

- **Cache poisoning by malicious shared device.** Sign-out clears
  IndexedDB. Document.
- **Cache size cap.** 10 MB across all active groups. Use
  `navigator.storage.estimate()` and evict oldest groups when over.
- **Service worker upgrade path.** Use a `versions` constant in
  `sw.ts`; on `activate`, prune old caches.
- **Firestore SDK offline.** The Firestore JS SDK has its own
  IndexedDB-backed offline cache. Decision: don't disable it; our
  cache is a *backup* for the message list specifically. They
  coexist.
- **Photos offline.** Skip — photos are large and the public bucket
  CDN handles its own offline (browser HTTP cache).
- **Sign-in flow offline.** Users can't sign in offline. Show a
  message; redirect when reconnected.
- **iOS PWA install gesture.** iOS doesn't fire
  `beforeinstallprompt`; show iOS-specific copy when Safari
  detected.
- **Next.js App Router + service worker scope.** SW scope is `/`,
  not `/_next/`. Document the precaches need to include `/_next/static`
  hashed JS chunks; build the SW from the manifest emitted by Next.

### Migration / rollout

- Feature flag: `NEXT_PUBLIC_DISABLE_SW=true` to opt out.
- Lighthouse CI job runs on every PR; fail if PWA score drops below
  85.
- New env vars: `NEXT_PUBLIC_DISABLE_SW`.

### Dependencies

T11 (auth — needs sign-in).

### Estimated complexity

Large. 2 days.

---

## T37 — Image thumbnails + responsive media — Sonnet

**Goal:** Photos served from the public bucket have generated
320/640/1280 variants. The chat UI uses `srcset` for bandwidth and CLS
improvements.

### Acceptance criteria

- A new photo upload produces three derived files within 30s of the
  original.
- Chat photo grid renders the 320 variant at < 768px and the 640 at
  desktop, verified via DevTools network tab.
- Backfill script processes a synthetic dataset of 50 originals in
  dev under 5 minutes.
- Lighthouse CLS on chat page measurably drops (before/after included
  in PR description).

### Files to create

- `functions/src/onPhotoUploadFinalize.ts` — Cloud Function (Storage
  trigger on the public bucket) that generates 320/640/1280 JPEGs via
  `sharp` and writes them under `derived/{originalName}_{w}.jpg`.
- `functions/src/services/imageVariants.ts` — pure helper using
  sharp.
- `frontend/components/chat/PhotoView.tsx` — `<img srcset>`,
  AVIF fallback, lazy loading, fixed aspect ratio container.
- `infra/scripts/backfill_thumbnails.py` — backfill helper.

### Files to modify

- `backend/app/services/storage.py` — return
  `{original, w320, w640, w1280}` from finalize endpoint. Resolve
  by string-template `derived/{name}_{w}.jpg`.
- `backend/app/models/upload.py` — extend `FinalizeUploadResponse`.
- `frontend/components/chat/MessageItem.tsx` — replace `<img>` with
  `<PhotoView />`.
- `infra/buckets.tf` — add lifecycle rule on the `derived/` prefix:
  90 days delete (re-derive on demand if needed).

### Data model changes

None. The derived URLs are a string template.

### Firestore rule deltas

None. `mediaRefs` continues to store the original public URL only;
derived URLs are computed client-side from the original.

### Backend interface

Extend `POST /api/uploads/{id}/finalize` response:

```python
class FinalizeUploadResponse(BaseModel):
    publicUrl: str        # original (existing)
    thumbnailUrl: str     # alias for w320 (new)
    variants: PhotoVariants  # { w320, w640, w1280 } — all string URLs
```

### Frontend interface

- `<PhotoView src={url} alt="" />`:
  - Computes the variants by replacing `.jpg` → `_320.jpg`,
    `_640.jpg`, `_1280.jpg`.
  - Renders `<img srcset="... 320w, ... 640w, ... 1280w" sizes="..." />`.
  - Wrapped in a fixed aspect ratio container (`aspect-[4/3]`) to
    eliminate CLS.
  - Lazy: `loading="lazy"` for offscreen.

### Cloud Functions

`functions/src/onPhotoUploadFinalize.ts`:
- Trigger: GCS finalize event on `jacob-media-public-{env}/uploads/...`.
  Skip when path contains `derived/`.
- Logic:
  - Download bytes.
  - Generate 320 / 640 / 1280 JPEG via sharp.
  - Upload each to `derived/{originalName}_{w}.jpg`.
- Cost: ~50ms CPU per image at 256MB memory.
- Idempotency: check if derived files already exist; skip if so.
  P3 with eventId record under
  `image_derivation_events/{eventId}` if needed.

### Test plan

**Functions:**
- `derives 3 variants from a sample image`.
- `skips when derived files already exist`.

**Frontend:**
- `PhotoView renders srcset with all three variants`.
- `lazy loading on offscreen images`.

**Backfill:**
- `script processes 50 synthetic uploads idempotently`.

### Edge cases / gotchas

- **Already-derived files.** Skip if derived exists; reduces cost.
- **Non-JPEG sources.** sharp converts WEBP/PNG → JPEG. Document
  format normalisation.
- **EXIF preservation.** Strip EXIF (privacy — GPS metadata).
  sharp's default removes orientation EXIF; explicitly call
  `.withMetadata({})` to drop the rest.
- **Sharp binary on Cloud Functions.** Pin version in `package.json`
  to a Linux-compatible build.
- **AVIF feature flag.** Documented; not v1.
- **CLS.** Aspect-ratio container is the primary CLS fix. Verify
  via Lighthouse.
- **Public bucket lifecycle.** Original kept indefinitely; derived
  90d delete; re-deriving on read is out of scope (Phase 3).

### Migration / rollout

- Backfill script run post-deploy: `python infra/scripts/backfill_thumbnails.py --dry-run` then `--apply`.
- Feature flag: `JACOB_PHOTO_VARIANTS_ENABLED` — backend includes
  variants in finalize response when true; frontend uses them when
  present.

### Dependencies

T10 (moderation pipeline).

### Estimated complexity

Medium. 1.5 days.

---

## T38 — Self-serve data export (GDPR / DSAR) — Opus

**Goal:** A user can request an export of their data and download a
JSON archive. Required for GDPR DSAR compliance and a courtesy for any
user.

### Why Opus

This task ships PII out of the system. Failure modes are catastrophic
in either direction:

1. **Including too much.** Leaking another user's data inside an
   export bundle (e.g. a leader's view of a member's email, or the
   contents of a private channel the requestor was no longer a
   member of). The bundle's *included scope* must be carefully
   bounded.
2. **Including too little.** A user's GDPR DSAR right is to receive
   *all data we have about them*. Missing categories means a
   non-compliant response.
3. **Concurrency.** A signed URL is a credential. If the
   download URL leaks, the bundle is accessible. The 7-day expiry
   and 14-day bucket lifecycle deletion compound — correctness
   matters at every step.
4. **Schema versioning.** The bundle is a contract with the user;
   future changes need a `schemaVersion` and a documented migration
   path. The schema isn't trivially obvious.

The privacy review on the bundle shape is a blocking gate. Pre-decide
the scope here so the reviewer has something to react to:

**In scope** for the bundle:
- Profile (`users/{uid}` + `users/{uid}/private/profile`).
- All messages authored by the user, across all groups, including
  soft-deleted (with tombstone status). Include parentMessageId.
- All reactions added by the user.
- All mentions of the user (`messages` where `mentions` includes uid).
- All audit_log entries with `actorUid == uid` OR `targetRef == users/{uid}`.
- Photo URLs uploaded by the user (URLs only, not bytes).
- Notification preferences and devices (last seen + uagent).
- Mute and block lists (so the user can re-create them on a new
  account).
- Group memberships (gid + role).

**Out of scope** for the bundle:
- Other users' messages, even in groups the user is in.
- Group metadata beyond what the user produced.
- Moderation queue rows authored about the user (those are
  evidentiary; provide them on a privacy-rights request via the
  runbook, not auto-bundle).

### Acceptance criteria

- A user requesting an export receives an email with a working
  download link within 30 minutes.
- The downloaded archive contains every category listed above,
  validated against a JSON schema.
- Photos are linked but not embedded.
- Re-requesting an export within an in-flight window returns 409.
- Signed URL after 7 days returns 403 from GCS (lifecycle test).
- Runbook covers the privacy-rights triage path: who responds, SLA
  (30 days for GDPR DSAR), failure escalation.

### Files to create

- `frontend/app/(authed)/settings/export/page.tsx` — request UI.
- `backend/app/services/export.py` — assembler.
- `backend/app/services/export_schema.py` — JSON Schema for the
  bundle.
- `infra/scheduled/process_export_jobs.py` — Cloud Run job
  consuming pending export jobs.
- `backend/app/templates/email/export_ready.html.j2`,
  `export_ready.txt.j2`.
- `firestore/tests/exports.rules.test.ts`.
- `infra/exports.tf` — `gs://jacob-exports-{env}` bucket with
  14-day lifecycle delete.

### Files to modify

- `backend/app/routers/account.py` — add
  `POST /api/account/export`,
  `GET /api/account/export/status`,
  `GET /api/account/export/{jobId}/download`.
- `backend/app/models/account.py` — `ExportRequest`,
  `ExportStatusResponse`.
- `firestore/firestore.rules` — `users/{uid}/exports/{jobId}` —
  owner-read, system-only-write.
- `infra/scheduler.tf` — add export-job processor (runs every 5
  minutes; consumes pending jobs).
- `docs/gdpr.md` — extend with the DSAR runbook.

### Data model changes

```
users/{uid}/exports/{jobId}: {
  requestedAt: Timestamp,
  startedAt: Timestamp | null,
  completedAt: Timestamp | null,
  failedAt: Timestamp | null,
  failureReason: string | null,
  downloadUrl: string | null,    // signed URL
  expiresAt: Timestamp | null,   // 7d after completedAt
  byteCount: number | null,
  schemaVersion: 1
}
```

### Firestore rule deltas

```
match /users/{uid}/exports/{jobId} {
  allow read: if isUser(uid);
  // Export job creation goes through the backend (Admin SDK).
  allow create, update, delete: if false;
}
```

### Backend interface

`POST /api/account/export`:
- **Auth:** signed-in user (self-export only).
- **Rate limit:** `EXPORT_REQUEST: str = "1/hour"` per uid (so retry
  loops don't fan out).
- **Behavior:**
  - Reject (409 `export_in_flight`) if a pending/started job exists
    for this uid.
  - Write `users/{uid}/exports/{jobId}` with `requestedAt`.
  - Return `{jobId, status: "queued"}`.

`GET /api/account/export/status`:
- **Auth:** signed-in.
- **Response:** the latest export job for the user.

`GET /api/account/export/{jobId}/download`:
- **Auth:** signed-in (must match the job's uid).
- **Response:** 302 redirect to the signed URL (the URL itself never
  goes to the email body if we have the redirect; but the email
  body can also include the direct URL as a backup for users who
  don't use the same browser session). **Decision:** include the
  signed URL directly in the email body — the redirect endpoint
  is secondary, used only by the in-app "Download" button.

`infra/scheduled/process_export_jobs.py`:
- Polls `collection_group("exports").where("startedAt", "==", null)`
  every 5 minutes.
- For each job: claim by setting `startedAt = SERVER_TIMESTAMP`,
  call `export.assemble(uid)`, write
  `gs://jacob-exports-{env}/{uid}/{jobId}.json.gz`, set
  `completedAt`, `downloadUrl` (7-day signed URL),
  `expiresAt = completedAt + 7d`.
- On failure: set `failedAt`, `failureReason`. Sentry capture.
- Concurrency cap: 5 concurrent jobs (the Cloud Run Job's
  `--max-retries 0` and the backend's "1 in-flight per user"
  combine to limit blast radius).

`backend/app/services/export.py`:
- `assemble(uid: str) -> ExportBundle`:
  - Profile + private/profile.
  - All messages where `authorUid == uid` (collection group on
    `messages`).
  - All reactions where `users/{uid}/reactions...` — tricky: the
    reaction docs are at
    `groups/{gid}/messages/{mid}/reactions/{slug}/users/{uid}`. Use a
    collection-group query on `users` filtered by id (the doc id
    is the user uid). **Decision:** add a field
    `users/{uid}/reactionsIndex/{slug+mid}` written by the trigger
    so we can avoid the collection-group query. **Or:** accept the
    one-time bigger query for export. Pre-decision: the latter.
    Documented cost: ~one collection-group query per export, scoped
    to `users` docs whose path contains the uid. Bound at 10k.
  - Mentions: query `messages` where `mentions` array-contains
    `uid`.
  - Audit log: `audit_log` where `actorUid == uid OR targetRef ==
    users/{uid}`.
  - Photo URLs: extract from messages' `mediaRefs`.
  - Memberships: collection-group `members` where `uid == uid`.
  - Mute/block lists.
- Validate bundle against `export_schema.py` JSON Schema before
  writing to GCS.

### Frontend interface

- `/settings/export`: button "Request export", state machine
  showing queued / processing / ready / expired. The "Download"
  button when ready hits the redirect endpoint.
- Once complete, also surface the signed URL in plain text so the
  user can copy/paste.

### Cloud Functions

None. Cloud Run Job processor.

### Test plan

**Backend:**
- `test_request_export_creates_job`.
- `test_request_export_in_flight_returns_409`.
- `test_status_returns_latest_job`.
- `test_assemble_bundle_includes_all_categories` — fixture user
  with messages/reactions/mentions; assert all categories present
  in the JSON.
- `test_assemble_bundle_excludes_other_users_messages`.
- `test_signed_url_after_7_days_returns_403` (lifecycle test;
  fast-forward via mock).

**Job:**
- `test_processor_handles_failure_writes_failedAt_and_sentry`.
- `test_processor_concurrency_cap_at_5`.

**Schema:**
- `test_bundle_validates_against_schema`.
- `test_schema_version_pinned_to_1`.

**Frontend:**
- `request export button calls /api/account/export`.
- `download button hits the redirect endpoint`.

### Edge cases / gotchas

- **Bundle size.** A heavy user could have 100k messages; use
  streaming JSON write (`ndjson`?). Decision: the bundle is a
  single JSON object; if size > 100MB, gzip; if size > 1GB,
  refuse with a friendly error and route to the runbook (manual
  process). Add a cap.
- **Signed URL leak.** Use V4 signed URL with 7-day expiry. Document
  the URL is sensitive in the email.
- **GDPR DSAR 30-day clock.** SLA is 30 days; the automated path
  responds in minutes. The runbook covers escalation.
- **CCPA delete-my-data.** Out of scope here — covered by T14
  account deletion. Cross-reference in `docs/gdpr.md`.
- **Account deleted while export in flight.** The processor detects
  this; the job fails with `account_deleted`. Don't bundle a
  half-account.
- **Bundle includes messages from groups the user has left.** Yes —
  the user authored them; their personal data right covers their own
  authored content even after leaving.
- **Hidden-by-moderation messages.** Include in the bundle —
  the user has a right to their own content even when moderation
  hid it.
- **Soft-deleted messages.** Include in the bundle with the
  tombstone flag.
- **PII in audit log payloads.** Existing `audit_log` payloads can
  include `reason: "User request"` etc. Sanitize: strip any
  uid except the requesting user's, and any email except theirs.
- **Self-mention.** Self-mentions are deduped at fan-out (T27).
  Consistent with bundle.
- **Schema versioning.** `schemaVersion: 1` on the top-level
  document. Future changes bump.
- **Email content safety.** The email body links to a URL; do not
  attach the bundle as a file (size, deliverability).
- **Concurrency cap.** Backend "1 per user" + processor "5 system-wide".
- **Reaction bundle scope.** The bundle includes the user's own
  reactions — not the list of reactors on their messages. Document.

### Migration / rollout

- New bucket `jacob-exports-{env}` with 14-day delete lifecycle.
- New env vars: `JACOB_EXPORT_BUCKET`, `JACOB_EXPORT_SIGNED_URL_TTL_DAYS=7`,
  `JACOB_EXPORT_DISABLED` kill-switch.
- Initial run: an admin tests a real export against their own
  account before the feature flag flips on.
- `docs/gdpr.md` — write the runbook before the feature ships.

### Dependencies

T03 (account), T14 (deletion semantics for tombstones), T18 (email).

### Estimated complexity

Large. Opus session, ~3 days.

---

## T39 — Phase 1 deferred pickup — schema, infra, and tests — Sonnet

**Goal:** Close out the M-class deferred items from
`docs/follow-ups/phase-1-deferred.md` that don't have their own Phase 2
task. One PR with one commit per sub-item — eight commits total.

This task is intentionally a hygiene PR. Each sub-item is small; the
value is shipping them together with a clean cut.

### Acceptance criteria

- Every sub-item lands in this PR or has a follow-up issue linked
  from the PR description.
- `docs/follow-ups/phase-1-deferred.md` is updated: addressed items
  are moved into a "Resolved in T39 / commit `<sha>`" section.
- Frontend integration tests run in CI and pass.
- Terraform `init` + `plan` from a clean clone runs end-to-end
  (verified by a fresh CI job).

### Sub-items (one commit each)

#### M4 — Cloud Scheduler IAM/OIDC Terraform

(Already partly done as part of T20/T21/T22's infra. Verify
and close.)

- Verify `infra/scheduler.tf` has explicit
  `google_cloud_scheduler_job` resources for `firestore_export`,
  `finalize_deletions`, and any new schedulers added by T29
  (`firestore_to_bigquery`), T34 (`cleanup_stale_devices`),
  T35 (`weekly_digest`), T38 (`process_export_jobs`).
- Each must have `oidc_token.service_account_email` pointing at a
  dedicated SA from `service_accounts.tf`.
- Document SA emails in `infra/README.md`.

#### M5 — Pin Dockerfile base image by digest

- Run `docker pull python:3.12-slim` and capture the digest.
- Replace `FROM python:3.12-slim` in `backend/Dockerfile` with
  `FROM python:3.12-slim@sha256:<digest>`.
- Verify Dependabot is configured to bump docker tags + digests.

#### M6 — Functions deploy lockfile

- Run `cd functions && npm install`.
- Commit `functions/package-lock.json`.
- Add a CI check that this stays consistent (lint that npm-vs-pnpm
  divergence is documented).

#### M9 — Frontend integration tests with the emulator

- Add `frontend/tests/integration/` with two specs:
  - `messageWriteRead.test.ts` — send + read by member; assert
    receipt.
  - `messageWriteDeniedNonMember.test.ts` — send + read denied for
    non-member.
- Run via `firebase emulators:exec --only firestore,auth "pnpm --filter jacob-frontend test:integration"` in CI.
- Add a new CI job `frontend-integration` that boots the emulator.

#### M10 — Test coverage gaps

Add tests called out in the Phase 1 review:
- `backend/tests/test_rate_limits.py` — assert
  `@limiter.limit(UPLOAD_INIT)` decorator is applied to
  `create_photo_upload`.
- `functions/src/__tests__/onMessageWrite.test.ts` — already
  exists post-T22; verify coverage of all 5 branches.
- `frontend/tests/useUser.test.tsx` — auth-state-change cookie
  race.
- `firestore/tests/rules.test.ts` — minor users, expired bans.

#### M11 — Resolve `groupIds` schema drift

(Already shipped in T22's prep — `groups/{gid}/members/{uid}.uid`
field plus collection-group query in `useGroups`.) Verify and
close. ADR `0003-collection-group-memberships.md` is already
present.

#### M12 — `useRecentMessages` N+1 reads

- Wrap the per-group reads in **SWR** (decision: SWR, not React
  Query — already cited in the deferred items doc; less weight,
  fits the small fetcher shape we use).
- Cache key: stable JSON of `groupIds`.
- Document the cache strategy in a comment at the top of
  `useRecentMessages.ts`.

#### L7 — Terraform remote state + provider pins

- Verify `infra/backend.tf` and `infra/versions.tf` are committed
  (already shipped; verify and close).
- Verify `.terraform.lock.hcl` is committed.
- Update `infra/README.md` with bucket creation steps.

### Files to create

- `frontend/tests/integration/messageWriteRead.test.ts`.
- `frontend/tests/integration/messageWriteDeniedNonMember.test.ts`.
- `frontend/tests/integration/setup.ts` — emulator client init.
- `functions/package-lock.json` (committed).

### Files to modify

- `backend/Dockerfile` — pin digest.
- `frontend/lib/hooks/useRecentMessages.ts` — wrap with SWR.
- `frontend/package.json` — add `swr` dependency.
- `.github/workflows/ci.yml` — new
  `frontend-integration` job.
- `docs/follow-ups/phase-1-deferred.md` — mark resolved items.
- `infra/README.md` — list every scheduler SA.

### Test plan

Each sub-item has its own scoped test (M9, M10 explicit). The PR's
DoD is:

1. CI green.
2. Emulator-backed integration tests pass locally and in CI.
3. `terraform init && terraform plan` from a clean clone runs without
   errors.
4. `cd functions && npm install --frozen-lockfile` succeeds.
5. `docker build backend/` succeeds with the digest-pinned image.
6. Phase-1-deferred doc updated.

### Edge cases / gotchas

- **Lockfile divergence.** `pnpm-lock.yaml` and
  `functions/package-lock.json` are independent — both are
  committed. CI verifies each in its own job.
- **Emulator boot in CI.** `firebase-tools` requires Java; CI
  already pulls Java 21.
- **Terraform GCS backend.** Runs against a real bucket; needs IAM.
  Document in `infra/README.md`.
- **SWR import path.** `useSWR` from `swr`. Bundle size impact
  ~6KB gz. Acceptable.
- **Existing `useRecentMessages` shape.** Don't change the hook's
  return signature; SWR is internal. Keep the `Promise.all` path
  inside the SWR fetcher — caching makes it a non-issue at the
  hot path.

### Migration / rollout

- One PR. Squash-merge with the eight commits visible in the
  squash body for traceability.
- Operator runbook updates in the same PR.

### Dependencies

T01–T18.

### Estimated complexity

Medium (eight small things — each is a half-day; together one
focused PR). 1.5 days.

---

## Appendix A — DESIGN-OPEN sections

None.

Every task above resolves to a concrete plan. Where the plan-doc had
ambiguity (e.g. T28 vendor choice, T34 cross-task dedup window, T38
bundle scope), the spec pre-decides and notes the decision. The
intent is for a Sonnet session to read one task and start coding —
if anything below is still ambiguous when actually implemented, that's
a bug in this spec, not a license to make a fresh architectural call.

---

## Appendix B — Recommended Opus → Sonnet downgrades

Based on what I saw while spec'ing, the three Opus-flagged tasks
(T28, T32, T38) earn their Opus budget for distinct reasons:

- **T28** — vendor / authorization-model decision is genuine; ADR
  must be written. Keep Opus.
- **T32** — new top-level rule shape with cross-task interactions.
  Could plausibly downgrade to Sonnet *after the rule is reviewed
  by Opus* — i.e. land the rules + ADR in an Opus pass, then T32
  body in Sonnet. Marginal; keep Opus for cohesion.
- **T38** — privacy/PII surface is real; the bundle scope decision
  here is irreversible (every released schema becomes a contract).
  Keep Opus.

No upgrades from Sonnet → Opus seem warranted. T24 (announcements
fan-out) and T34 (FCM consumer) are intricate but pattern-matched
against existing code, and the patterns (P3, P7, P8) are now
written down here; Sonnet should land them cleanly.

