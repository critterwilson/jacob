# JACOB — Engineering conventions
 
This file is loaded automatically by Claude Code on every task. It pins cross-cutting decisions so individual task specs in `DEV_PLAN.md` can stay tight. Read it before starting any task.
 
## Project in one paragraph
 
JACOB is a small-group messaging web app for Christian small groups (Phase 1). The backend is FastAPI on Cloud Run for non-realtime APIs (uploads, moderation, admin, account lifecycle). Real-time chat, threads, and reads/writes for end-user data go directly through the **Firestore client SDK** with **Firestore Security Rules** as the access-control layer. There is intentionally **no monolithic API gateway** in front of Firestore — that would defeat the point of using it.
 
## Tech stack (pinned versions are recommendations, not constraints)
 
- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Python 3.12 + FastAPI + uvicorn, deployed as a container on Cloud Run
- **Data:** Cloud Firestore (Native mode, single region: `nam5`)
- **Auth:** Firebase Authentication (email/password + Google sign-in)
- **Storage:** Google Cloud Storage (one bucket for public media, one for quarantined uploads)
- **Moderation:** Cloud Vision API (SafeSearch), Cloud Natural Language API, third-party CSAM hash service (decide vendor before building T11)
- **Email:** SendGrid (free tier to start)
- **Observability:** Cloud Logging, Cloud Monitoring, Sentry (free tier), Cloud Scheduler for cron jobs
- **CI/CD:** GitHub Actions → Cloud Build → Cloud Run + Firebase Hosting
- **Secrets:** Google Secret Manager. Never commit secrets. `.env.local` is gitignored.
## Repo layout
 
```
/                       # monorepo
├── CLAUDE.md           # this file
├── DEV_PLAN.md         # Phase 1 task specs
├── README.md           # human-facing project intro
├── .github/workflows/  # CI/CD
├── functions/          # Cloud Functions for Firebase (TypeScript) — Firestore triggers only
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
├── frontend/           # Next.js app
│   ├── app/            # App Router pages
│   ├── components/     # React components
│   ├── lib/            # client utilities (firebase init, hooks, etc.)
│   ├── tests/          # vitest tests
│   └── package.json
├── backend/            # FastAPI service
│   ├── app/
│   │   ├── main.py     # FastAPI app + middleware
│   │   ├── routers/    # one file per resource
│   │   ├── services/   # business logic, external API clients
│   │   ├── models/     # pydantic models
│   │   └── deps.py     # FastAPI dependencies (auth, db, etc.)
│   ├── tests/          # pytest tests
│   ├── pyproject.toml
│   └── Dockerfile
├── firestore/
│   ├── firestore.rules # security rules — single source of truth
│   ├── firestore.indexes.json
│   └── seed/           # seed scripts (stickers, etc.)
├── infra/              # IaC, deploy scripts
└── docs/               # ADRs and design notes
```
 
## Architectural rule of thumb
 
**As of M6 of the data-layer migration**, every Firestore read and write
the frontend performs goes through the FastAPI backend's `/api/*`
surface. The Firestore client SDK is no longer used for data access —
Firebase Auth and Firebase Storage are the only client SDKs that
remain. Security rules are tightened to default-deny on every
previously-client-accessible collection; the rules file at
`firestore/firestore.rules` is now mostly defense-in-depth.

**Decide where each operation lives:**

- **Default: a FastAPI endpoint.** Verify the Firebase ID token via
  `get_current_user`, compose the right access dep
  (`require_member` / `require_leader` /
  `require_member_or_public` / `require_not_banned`), and use the
  Firebase Admin SDK to read or write. This is the rule for every
  user-facing data access.
- **Firestore-triggered work** (denormalisation, post-write fan-out,
  the search sidecar) lives in **Cloud Functions for Firebase (v2,
  TypeScript only)** — `functions/`. Use it only when reactive
  server-trusted work needs to follow a write the API just made.
- **Realtime push** to clients was deferred — chat polls the backend
  every 10s in the absence of M5 (SSE). M5 reintroduces sub-second
  push when revisited.

The previous "trust the client when possible" rule no longer applies.
The migration has shifted the trust boundary fully to the backend
because Firestore client SDK calls are blocked by adblockers (the
load-bearing reason for M1–M6). See `docs/data-layer-migration-plan.md`.
 
## Firestore conventions
 
### Collection layout (canonical — do not invent new collections without an ADR)
 
```
users/{uid}
  email, displayName, photoURL, createdAt, isMinor, role, deletionRequestedAt
users/{uid}/private/profile        # PII, leader/mod-only fields
groups/{gid}
  name, description, createdBy, createdAt, isPrivate, inviteCode, memberCount, stickerSet
groups/{gid}/members/{uid}
  role (member|leader), joinedAt
groups/{gid}/messages/{mid}
  authorUid, body, stickerIds[], createdAt, editedAt, deletedAt,
  parentMessageId (null for top-level), threadReplyCount, mediaRefs[]
stickers/{stickerId}
  name, slug, audience (christian|bjj|general), order, retiredAt
moderation_queue/{itemId}
  resourceRef, reason, status (pending|approved|rejected), createdAt, reviewedBy
bans/{uid}
  reason, bannedBy, expiresAt
audit_log/{eventId}
  actorUid, action, targetRef, createdAt, payload
```
 
### Querying
 
- **Always paginate.** Default page size: 50 messages. Never write `.get()` on an unbounded collection.
- **Listen narrowly.** Use `onSnapshot` only for the active group's recent messages and threads currently open. Tear down listeners on unmount.
- **No collection-group queries** without an explicit ADR — they need composite indexes and bypass the natural permission boundary.
- **Compound queries** (where + orderBy) need a composite index. Add it to `firestore.indexes.json`, not via the console.
### Writes
 
- **Never write to `users/{otherUid}`** from the client. User profile writes are scoped to the authenticated user.
- **Use transactions** for any read-then-write that touches a shared counter (e.g., `memberCount`, `threadReplyCount`). Use `FieldValue.increment()` where possible — it's cheaper.
- **Server timestamps** (`serverTimestamp()`) for `createdAt` / `editedAt`. Never trust client time.
### Security rules philosophy
 
Security rules in `firestore/firestore.rules` are the source of truth for who can do what. Every change to the data model must come with a rule change in the same PR. Rules ship with **emulator tests** in `firestore/tests/` — no rule lands without a test that proves both the allowed and denied cases.
 
## Backend (FastAPI) conventions
 
### Auth
 
- Every protected endpoint depends on `get_current_user` (in `backend/app/deps.py`), which:
  1. Reads `Authorization: Bearer <id_token>` from the request
  2. Verifies it via `firebase_admin.auth.verify_id_token`
  3. Returns a `CurrentUser` dataclass (uid, email, claims)
  4. Raises 401 on missing/invalid token
- Admin-only endpoints depend on `require_admin` which checks the `admin` custom claim.
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
- Limits live in `backend/app/limits.py`. See task T17 for the table.
### Validation
 
- Every request body is a pydantic v2 model. No raw `dict` parameters.
- Every response is a pydantic model or `JSONResponse` with an explicit shape. Don't return SDK objects directly.
## Frontend (Next.js) conventions
 
- **App Router only.** No Pages Router code.
- **Server components by default.** Client components only when interactivity, hooks, or Firebase realtime listeners are needed (mark with `"use client"`).
- **Firebase init** lives in `frontend/lib/firebase.ts`. Import from there; never `initializeApp` again.
- **Auth state** via a single `AuthProvider` (React context) wrapping the app. Components consume `useAuth()`.
- **Firestore reads** go through small typed hooks in `frontend/lib/hooks/` (e.g., `useGroupMessages(gid)`). Components don't call the SDK directly.
- **Forms:** `react-hook-form` + `zod`. Same zod schema validates client and (where reused) server.
- **Styling:** Tailwind. Avoid custom CSS files. Component variants via `clsx` or `cva`.
- **No localStorage for auth tokens** — Firebase manages session persistence itself.
## Testing
 
Light, pragmatic, focused on behavior — not 100% coverage:
 
- **Backend:** pytest. One test file per router. Mock `firebase_admin` and external SDKs at the module level. Smoke + critical-path tests are required; exhaustive branch coverage is not.
- **Frontend:** vitest + React Testing Library. Test components that contain logic; skip components that are pure layout.
- **Security rules:** `@firebase/rules-unit-testing` against the emulator. Required for every rule change.
- **CI gate:** all tests pass + ruff/black/mypy on backend + eslint/prettier/tsc on frontend before merge.
## Environment & secrets
 
- Local: `.env.local` per service, gitignored. A committed `.env.example` documents required keys.
- Deployed: Google Secret Manager, mounted as env vars by Cloud Run.
- Required env vars per service are documented in each service's `README.md`. CI fails if `.env.example` and the README diverge.
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
 
- Never write to Firestore from the client without a corresponding security rule that proves it's safe.
- Never call `firebase_admin` from the frontend.
- Never use `any` in TypeScript — if you reach for it, pause and re-derive the type.
- Never use `os.environ.get(...)` scattered through the backend — load env via a single `Settings` pydantic-settings class in `backend/app/config.py`.
- Never store secrets in `next.config.js` or any committed file.
- Never serve user-uploaded images directly without going through the moderation pipeline first (T11). The bucket policy enforces this; do not work around it.
- Never log a full user-supplied message body. Log `len(body)` and the message ID.
- Never call a paid external API (Vision, NL API, SendGrid) inside a Firestore-triggered function without a circuit breaker — a runaway loop costs real money.
- Never accept the model's first answer when it's writing security rules. Read them line by line.
