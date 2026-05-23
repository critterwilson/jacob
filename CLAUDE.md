# JACOB — Engineering conventions

This file is loaded automatically by Claude Code on every task. It pins cross-cutting decisions so individual task specs in `DEV_PLAN.md` can stay tight. Read it before starting any task.

*Last revised: 2026-05-23 (delegated membership / ADR 0015).*

## Project in one paragraph

JACOB is a small-group messaging web app for Christian small groups. The frontend (Next.js) calls a FastAPI backend on Cloud Run for **all** end-user data access through `/api/*`. Firebase Auth and Firebase Storage are still used directly by the client; nothing else is. Cloud Functions for Firebase handle Firestore-triggered fan-out (denormalisation, search-sidecar indexing, FCM delivery). Firestore security rules are **default-deny** on every previously-client-accessible path post-M6 — they remain in the repo as defense-in-depth, not as the load-bearing access-control surface they were before M6.

## Tech stack (pinned versions are recommendations, not constraints)

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS, deployed to Firebase **App Hosting** (managed Cloud Run, SSR).
- **Backend:** Python 3.12 + FastAPI + uvicorn, deployed as a container on Cloud Run.
- **Functions:** Cloud Functions for Firebase v2 (TypeScript, `functions/`) — Firestore triggers + Cloud Tasks worker for FCM.
- **Data:** Cloud Firestore (Native mode, single region: `nam5`). BigQuery (`jacob_analytics` dataset) for daily analytics snapshots; Typesense (self-hosted on Cloud Run) for full-text search.
- **Auth:** Firebase Authentication (email/password + Google sign-in).
- **Storage:** Google Cloud Storage (one bucket for public media, one for quarantined uploads).
- **Moderation:** Cloud Vision API (SafeSearch), Cloud Natural Language API, third-party CSAM hash service (`JACOB_HASH_PROVIDER`).
- **Email:** SendGrid (transactional + weekly digest).
- **Observability:** Cloud Logging, Cloud Monitoring, Sentry (backend + frontend), Cloud Scheduler for cron jobs.
- **CI/CD:** GitHub Actions → Cloud Run + Firebase App Hosting + Firebase Functions + Firestore rules/indexes. There is no Cloud Build step — the backend image is built directly in the Actions runner with `docker build` and deployed via `gcloud run deploy`.
- **Secrets:** Google Secret Manager. Never commit secrets. `.env.local` is gitignored.

## Repo layout

```
/                       # pnpm workspace monorepo
├── CLAUDE.md           # this file
├── DEV_PLAN.md         # Phase 1 task specs (note: parts pre-date M6 — verify against code)
├── README.md           # human-facing project intro
├── firebase.json       # Firebase deploy config (Hosting fallback, Firestore, Functions, RTDB, emulators)
├── .firebaserc         # Firebase project aliases
├── pnpm-workspace.yaml # workspace roots
├── .github/workflows/  # ci.yml + deploy.yml
├── functions/          # Cloud Functions for Firebase (TypeScript) — Firestore triggers + FCM worker
│   └── src/            # onMessageWrite, onReactionWrite, onMessageIndex, onPhotoUploadFinalize, sendFcmTask, …
├── frontend/           # Next.js app (App Router) — deploys via Firebase App Hosting
│   ├── app/            # routed pages (server components by default)
│   ├── components/     # React components
│   ├── content/legal/  # privacy.md, terms.md, guidelines.md (rendered by LegalDocument.tsx)
│   ├── e2e/            # Playwright specs (run against the staging App Hosting URL in CI)
│   ├── lib/            # api.ts, hooks/, auth-context, sentry, push, …
│   ├── tests/          # vitest tests
│   └── apphosting.yaml # App Hosting backend config
├── backend/            # FastAPI service
│   ├── app/
│   │   ├── main.py     # FastAPI app + middleware
│   │   ├── routers/    # one file per resource; mounts under /api
│   │   ├── services/   # business logic, external API clients
│   │   ├── models/     # pydantic models
│   │   ├── deps.py     # FastAPI dependencies (auth, db, etc.)
│   │   ├── config.py   # single Settings (pydantic-settings) class
│   │   └── limits.py   # slowapi rate-limit table
│   ├── tests/          # pytest tests (run against the Firestore emulator in CI — H8)
│   ├── pyproject.toml
│   └── Dockerfile
├── firestore/
│   ├── firestore.rules     # default-deny post-M6; defense-in-depth
│   ├── firestore.indexes.json
│   ├── seed/               # seed scripts (stickers, etc.)
│   └── tests/              # @firebase/rules-unit-testing — required for every rule change
├── infra/
│   ├── *.tf                # Terraform: Cloud Run, BigQuery, buckets, scheduler, WIF, …
│   ├── scheduled/          # Cloud Run Job entrypoints (firestore_to_bigquery, finalize_deletions, daily_verse, weekly_digest, …)
│   ├── scripts/            # one-shot ops scripts (e.g. reindex_messages.py)
│   ├── seed/               # data-seed jobs
│   └── bigquery/           # views.sql
└── docs/
    ├── data-model.md           # canonical Firestore schema — see "Collection layout" below
    ├── data-layer-migration-plan.md
    ├── adr/                    # ADRs: 0001, 0003, 0004, 0005, 0007, 0009, 0010, 0011, 0012 (superseded by 0014), 0013, 0014 (0002/0006/0008 were planned but those tasks were parked)
    ├── runbooks/               # operational runbooks
    ├── follow-ups/             # phase-1-deferred.md, phase-2-deferred.md, phase-3-deferred.md, phase-3-parked.md
    └── legal/                  # internal legal-team source docs
```

## Membership model (ADR 0015)

Open self-signup, delegated approval. Anyone with a verified email can
complete onboarding and get a `users/{uid}` doc (the existing
"approved member" load-bearing artifact). The new account lands in an
"unaffiliated" tier — it has no group memberships, so the existing
`require_member` deps gate every group-scoped surface. Public boards,
discover, search, and request-to-join stay reachable.

Three approval surfaces:

- **Owner approves group leaders** via `/api/admin/leader-applications*`.
  The `leader_applications/{appId}` collection is the queue. On
  approval the backend creates the target `groups/{gid}` with the
  applicant as leader. Direct `POST /api/groups` is owner/admin-only.
- **Group leaders approve adult members into their group** via the
  pre-existing `groups/{gid}/joinRequests/{uid}` flow from PR #284.
  Adults arriving via an invite (`POST /api/groups/join`) are
  auto-joined — the leader is vouching by inviting.
- **Owner approves minors into any group** via
  `/api/admin/minor-join-requests` and
  `/api/admin/groups/{gid}/join-requests/{uid}/(approve|reject)`. Two
  load-bearing safety rules: (1) the leader-side approve/reject
  endpoint refuses requests flagged `requiresOwnerReview` with
  `403 minor_owner_review_required`, and (2) the owner approve
  endpoint refuses without `parentalConsentObtained: true` with `422
  parental_consent_required`. An invite never bypasses owner approval
  for a minor — the consume happens only on owner approval.

The legacy `applications/{uid}` collection from ADR 0012 stays in the
data model for the residual queue; `POST /api/applications/me` returns
410 Gone. See [docs/adr/0015-delegated-membership.md](docs/adr/0015-delegated-membership.md).

## Architectural rule of thumb

**Decide where each operation lives:**

- **Default: a FastAPI endpoint under `/api/*`.** Verify the Firebase ID token via `get_current_user`, compose the right access dep (`require_member` / `require_leader` / `require_member_or_public` / `require_not_banned`), and use the Firebase Admin SDK to read or write. This is the rule for every user-facing data access.
- **Firestore-triggered work** (denormalisation, post-write fan-out, the search sidecar, FCM dispatch) lives in **Cloud Functions for Firebase v2 (TypeScript only)** — `functions/`. Use it only when reactive server-trusted work needs to follow a write the API just made.
- **Realtime push** to clients was deferred — chat polls the backend roughly every 10s via the polling pattern below. M5 reintroduces sub-second push when revisited.

The pre-M6 "trust the client when possible" rule no longer applies. Firestore client SDK calls are blocked by adblockers (the load-bearing reason for M1–M6); the trust boundary now sits at the FastAPI surface. See `docs/data-layer-migration-plan.md`.

## Firestore conventions

### Collection layout

The canonical schema lives in **[docs/data-model.md](docs/data-model.md)**. Read it before adding a collection or field. The data model has grown well beyond the original Phase 1 set — it now includes `users/{uid}/{mutes,blocks,devices,notifications,notificationPrefs,exports,plan_progress}` subcollections; org-tier collections (`orgs/`, `orgs/{orgId}/{admins,members,invites}`, `org_slugs/`, `org_consent_tokens/`, `domain_claims/`); cross-group boards (`boards/{boardId}/posts/{postId}/{replies,reactions/{slug}/users/{uid}}`); per-message reactions and pinning; per-group `events/{eid}/rsvps/{uid}`; idempotency markers (`_events`, `_reaction_events`, `_index_events`, `_post_events`, `_reply_events`, `_member_events`); search/moderation state collections; feature flags (`feature_flags/`); incident banners (`active_incidents/`); ban appeals; transparency reports; daily verse; NCMEC cases; and several backend-only stores. Do not invent new collections without an ADR — schema changes require a `firestore.rules` and `firestore.indexes.json` update in the same PR.

### Querying

- **Always paginate.** Default page size: 50 messages. Never write `.get()` on an unbounded collection.
- **No collection-group queries from the client.** They're forbidden by default-deny rules anyway. Server-side collection-group reads (Admin SDK) need a CG index in `firestore/firestore.indexes.json` and an explicit comment justifying the cross-group scope.
- **Compound queries** (where + orderBy) need a composite index. Add it to `firestore.indexes.json`, not via the console.

### Realtime and polling hygiene

There is no client-side `onSnapshot`. Chat (`useGroupMessages`) gets sub-second updates via Server-Sent Events from the FastAPI backend (M5 / ADR 0013); every other surface still polls. Polling is also the always-on fallback for chat when SSE fails. Direct Firestore listeners from the browser remain off the table (adblock issue that triggered the M1–M6 rewrite). See `docs/adr/0013-sse-realtime-chat.md` and `docs/runbooks/realtime-messages.md` for the design and operational playbook.

**Polling pattern (every surface)**

- Initial fetch of the latest page (`apiGet(...)`).
- Subsequent polls send `since=<latestCreatedAt>` (or equivalent cursor) and use `apiGetConditional` so the backend can short-circuit unchanged responses with `304 Not Modified` via `If-None-Match` / ETag.
- Polling is paused while `document.hidden` is true; visibility-change events resume it. Hooks tear down their interval on unmount.
- Default poll interval is ~10s for chat. Tune per resource — most non-chat surfaces poll every 30–60s or refetch only on focus.

**SSE transport (chat only, M5)**

- Client opens `GET /api/groups/{gid}/messages/stream` via `frontend/lib/sse.ts` — a `fetch`-based reader rather than native `EventSource` because we need the `Authorization` header for the Firebase ID token.
- Backend holds the connection open and emits `event: message` frames as Firestore reports new/updated messages. Implementation: `backend/app/services/stream_hub.py` runs one Admin SDK listener per active group per Cloud Run instance, fanning changes onto per-connection `asyncio.Queue`s.
- Polling pauses once the stream opens; resumes immediately if the stream errors. After 5 failed reconnect attempts the hook gives up on SSE for the rest of the session and stays on polling — no flapping.
- Stream closes when `document.hidden` becomes true and reopens on visibility-change. Closed on unmount.
- Kill-switch: set `JACOB_MESSAGES_STREAM_DISABLED=1` on the Cloud Run service to force every client back to polling.

See `frontend/lib/hooks/useGroupMessages.ts` for the chat reference implementation; `useThreadMessages.ts` still polls only (thread realtime is a tracked follow-up — same pattern, different endpoint).

### Writes

- **All client writes go through `/api/*`.** Direct Firestore writes from the browser are rejected by default-deny rules.
- **Use transactions** server-side for read-then-write that touches a shared counter. Prefer `FieldValue.increment()`. Where a counter is hot, denormalise it via a Cloud Function trigger (see `functions/src/onMemberWrite.ts` for the pattern).
- **Server timestamps** (`SERVER_TIMESTAMP` / `serverTimestamp()`) for `createdAt` / `editedAt`. Never trust client time, even via the API.

### Default-deny rules + backend-mediated writes

`firestore/firestore.rules` is default-deny on every previously-client-accessible path. The catch-all at the bottom (`match /{document=**} { allow read, write: if false; }`) is intentional. Rules still ship with **emulator tests** in `firestore/tests/` — every rule change needs a test that proves both the allowed and denied cases. Server-side Admin SDK access bypasses rules; that's the only path for end-user data writes post-M6.

## Backend (FastAPI) conventions

### API versioning

The canonical surface is `/api/v1/*`. A `_V1PathRewriteMiddleware` in `backend/app/main.py` rewrites `/api/v1/<rest>` → `/api/<rest>` before route matching, so both prefixes serve identical responses. The unversioned `/api/*` routes are a **deprecated alias** — they will be removed once the frontend cutover is confirmed stable in production for a few weeks. Do not add new router prefixes without the `/api/v1/` form in mind; the middleware handles the rewrite transparently so no router-level changes are needed. The OpenAPI docs at `/docs` show only the unversioned paths (this is a known limitation of the middleware approach).

### Auth

- Every protected endpoint depends on `get_current_user` (in `backend/app/deps.py`), which:
  1. Reads `Authorization: Bearer <id_token>` from the request
  2. Verifies it via `firebase_admin.auth.verify_id_token`
  3. Returns a `CurrentUser` dataclass (uid, email, claims)
  4. Raises 401 on missing/invalid token
- Admin-only endpoints depend on `require_admin` which checks the `admin` custom claim. Group-scoped endpoints use `require_member` / `require_leader`. See `backend/app/deps.py` for the full dep set.

### Errors

Standard error response shape:

```json
{ "error": { "code": "string_constant", "message": "human-readable", "details": {} } }
```

Status codes: 400 invalid input, 401 unauthenticated, 403 unauthorized, 404 not found, 409 conflict, 422 unprocessable, 429 rate-limited, 500 internal. Never leak stack traces in production responses; log them via `logger.exception(...)` instead.

### Logging

- Use the standard `logging` module configured in `backend/app/main.py` to emit JSON-formatted logs (Cloud Logging picks them up automatically).
- Every request gets a `request_id` (middleware-assigned) included in every log line.
- `logger.info` for normal flow, `logger.warning` for handled bad input, `logger.error` for failures, `logger.exception` for uncaught.
- Never log: ID tokens, full image bytes, full message bodies (log message ID + length).

### Rate limiting

- Use `slowapi` (Redis-free, per-instance is fine for v1 — Cloud Run with min-instances=0 is acceptable since attackers retrying after a cold start hit the limiter again on the new instance).
- Limits live in `backend/app/limits.py`.

### Validation

- Every request body is a pydantic v2 model. No raw `dict` parameters.
- Every response is a pydantic model or `JSONResponse` with an explicit shape. Don't return SDK objects directly.

## Frontend (Next.js) conventions

- **App Router only.** No Pages Router code.
- **Server components by default.** Mark client components with `"use client"` only when interactivity, hooks, or browser APIs are needed.
- **Firebase init** lives in `frontend/lib/firebase.ts`. Import from there; never `initializeApp` again.
- **Auth state** via a single `AuthProvider` (`frontend/lib/auth-context.tsx`). Components consume `useAuth()`.
- **Data access goes through `frontend/lib/api.ts`** (`apiGet`, `apiGetConditional`, `apiPost`, `apiDelete`, …). The hooks in `frontend/lib/hooks/` (e.g. `useGroupMessages`, `useBoards`, `useDailyVerse`) wrap `api.ts` and provide React-idiomatic state. Components never call `api.ts` directly and never call the Firestore SDK.
- **Forms:** `react-hook-form` + `zod`. Same zod schema validates client and (where reused) server.
- **Styling:** Tailwind. Avoid custom CSS files. Component variants via `clsx` or `cva`.
- **No localStorage for auth tokens** — Firebase manages session persistence itself.

## Testing

Light, pragmatic, focused on behavior — not 100% coverage:

- **Backend:** pytest, run against the Firestore emulator in CI (H8). One test file per router. Mock external SDKs (Vision, NL, SendGrid, hash provider) at the module level. Smoke + critical-path tests are required; exhaustive branch coverage is not.
- **Frontend:** vitest + React Testing Library for unit tests; Playwright (`frontend/e2e/`) runs against the staging App Hosting URL post-deploy.
- **Security rules:** `@firebase/rules-unit-testing` against the emulator. Required for every rule change.
- **CI gate:** all tests pass + ruff/black/mypy on backend + eslint/prettier/tsc on frontend before merge.

## Environment & secrets

- Local: `.env.local` per service, gitignored. A committed `.env.example` documents required keys, organised by task ID. Each service's `README.md` walks through setup; keep it in sync with `.env.example` by hand (there is no CI check enforcing this — adding one is a tracked follow-up).
- Deployed: Google Secret Manager, mounted as env vars by Cloud Run.

## Commit & PR style

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`. One concern per commit.
- PR title = the task ID + short description, e.g., `T07: group chat top-level messages`.
- PR description = link to the task in `DEV_PLAN.md` + screenshot/curl trace if user-visible + checklist of acceptance criteria with each box checked.
- Squash-merge to `main`. `main` is always deployable.

## Definition of done (applies to every task)

A task is done when:

1. All acceptance criteria in its spec pass.
2. Tests for the new behavior exist and pass locally.
3. CI is green (lint, type-check, tests).
4. Security rules are updated if the data model changed, and rule tests pass.
5. Any new env var is added to `.env.example` and the service README.
6. The PR description checks every acceptance criterion.
7. If the task touched a flow that another task depends on, the upstream task's spec is updated to reference the actual implementation.

## Things to never do

- Never write to Firestore from the client. Default-deny rules will reject the write; the right path is a `/api/*` endpoint.
- Never call `firebase_admin` from the frontend.
- Never use `any` in TypeScript — if you reach for it, pause and re-derive the type.
- Never use `os.environ.get(...)` scattered through the backend — load env via the single `Settings` pydantic-settings class in `backend/app/config.py`.
- Never store secrets in `next.config.js` or any committed file.
- Never serve user-uploaded images directly without going through the moderation pipeline first. The bucket policy enforces this; do not work around it.
- Never log a full user-supplied message body. Log `len(body)` and the message ID.
- Never call a paid external API (Vision, NL API, SendGrid) inside a Firestore-triggered function without a circuit breaker — a runaway loop costs real money.
- Never accept the model's first answer when it's writing security rules. Read them line by line — even though they're now defense-in-depth, a hole here is a hole.
