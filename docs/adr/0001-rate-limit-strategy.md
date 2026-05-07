# ADR 0001 — Rate Limit Strategy

**Status:** Accepted, partially superseded by M4 (data-layer migration)
**Date:** 2026-05-01
**Task:** T17

---

> **Superseded-by note (2026-05-06).** The "Message posting (direct
> Firestore path)" section below assumes the frontend writes messages
> directly via the Firestore client SDK. That premise no longer
> holds: the M1–M6 data-layer migration (see
> `docs/data-layer-migration-plan.md`) routes **every** end-user
> write through the FastAPI backend. Message posting now goes
> through `POST /api/groups/{gid}/messages` — i.e., **Option A** in
> the trade-off below — and is rate-limited like any other
> endpoint via `slowapi`. The Cloud Function circuit-breaker that
> Option B contemplated is therefore unnecessary at the Firestore
> tier; the backend slowapi limit (defined in
> `backend/app/limits.py`, applied via the keying logic in
> `backend/app/middleware/rate_limit.py`) is the authoritative
> rate-limit surface for posts and every other write.
>
> The auth-surface and backend-endpoint sections of this ADR remain
> accurate.

---

## Context

T17 requires rate limits on the following abuse surfaces:

| Surface                 | Limit              |
|-------------------------|--------------------|
| Auth (sign-in attempts) | 5 / minute / IP    |
| Sign-up                 | 3 / hour / IP      |
| Password reset emails   | 3 / hour / email   |
| Message posting         | 30 / minute / user |
| Photo upload init       | 10 / hour / user   |
| Group invite generation | 20 / day / leader  |
| Reports                 | 10 / day / user    |

Three implementation approaches were considered:

1. **slowapi** — per-instance in-memory rate limiting integrated with FastAPI via decorators.
2. **Redis-backed distributed rate limiting** — consistent limits across all Cloud Run instances.
3. **Firestore Security Rules timestamp comparison** — express rate limits directly in Firestore rules.

---

## Decisions

### Auth surfaces (sign-in, sign-up, password reset)

Firebase Authentication natively enforces rate limits on all identity operations (sign-in, sign-up, password reset). These limits apply at the Firebase project level, globally across all clients, and cannot be trivially bypassed. Adding a backend proxy solely to enforce limits at our tier would add latency and complexity with no security benefit.

**Decision:** delegate auth surface limits to Firebase Authentication. No backend endpoints for these surfaces exist; any future auth-proxy endpoint must add a `@limiter.limit(...)` decorator before shipping.

### Backend endpoints (upload init, invite rotation, reports)

These flows go through the FastAPI backend, making per-user or per-IP limits straightforward via slowapi.

**Decision:** use **slowapi** (single-instance in-memory, no Redis). Each Cloud Run instance maintains its own counter. This is acceptable for v1 because:
- Cloud Run's default behaviour keeps warm instances alive between requests, so a single abusive client typically hits the same instance.
- Even across a cold-start scenario, an abuser who triggers a new instance still hits the limiter on that instance immediately on the next request.
- Out-of-scope for v1: distributed rate limiting via Redis (requires a managed Redis instance and network egress cost).

Key function: `request.state.uid` if the user is authenticated (set by `get_current_user`), otherwise client IP. This ensures per-user semantics on protected endpoints.

### Message posting (direct Firestore path)

End-user messages are written directly to Firestore via the client SDK, bypassing the FastAPI backend entirely. Firestore Security Rules can compare timestamps (e.g., `request.time > resource.data.createdAt + duration.value(2, 's')`), but expressing "30 in the last 60 seconds" cleanly requires a write-count document that itself needs atomic updates — adding complexity and Firestore write costs.

Two options were evaluated:

**Option A:** Route all message writes through a FastAPI endpoint (`POST /api/groups/{gid}/messages`). Pros: trivial to enforce the 30/min limit with slowapi. Cons: doubles write latency (HTTP round trip + Firestore write), breaks the "no API gateway in front of Firestore" architectural principle, and eliminates the offline write-queue capability.

**Option B (chosen):** Keep the direct Firestore write path. Accept that the 30/min limit is **best-effort** at the backend layer. A future Cloud Function (v2 Firestore trigger) will monitor `groups/{gid}/messages` write velocity per user and temporarily disable accounts that exceed the limit by a large margin (e.g., > 200 messages/min sustained). This Cloud Function is **out of scope for T17** but the strategy is documented here to unblock implementation.

**Decision:** Message posting limits are best-effort for v1. The direct Firestore path is preserved. A follow-up task will implement the Cloud Function circuit-breaker.

### Firestore Security Rules rate limiting

Expressing "N writes in window W" in Firestore Rules requires reading a rate-tracking document inside the rule, which is not supported by the Rules language for write operations (you can read existing documents but not write counters atomically). The approach is technically unsound.

**Decision:** no Firestore Rules changes for rate limiting in T17.

---

## Consequences

- Each rate-limited backend endpoint returns HTTP 429 with a `Retry-After` header when the limit is exceeded.
- Single-instance counters reset on Cloud Run instance recycling. This is acceptable for v1 abuse prevention.
- Before adding Redis in a future task: benchmark actual abuse patterns and confirm the cross-instance gap is causing real harm.
- Message posting abuse is detectable post-hoc via Cloud Logging / Cloud Monitoring; an alert should be configured before public beta.
