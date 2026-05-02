/**
 * T28 — minimal Typesense REST client used by `onMessageIndex`.
 *
 * We deliberately avoid the official `typesense` SDK to keep the function
 * cold-start light. Only three operations are required from the trigger:
 *
 *   - upsert(doc)              POST   /collections/{c}/documents?action=upsert
 *   - deleteById(id)           DELETE /collections/{c}/documents/{id}
 *   - health()                 GET    /health
 *
 * All exports are pure-ish or DI-friendly so unit tests can drive them
 * without a network. The trigger module passes a real `fetch`; tests pass
 * a fake.
 */

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export type TypesenseOptions = {
  host: string; // e.g. https://typesense-internal.run.app
  apiKey: string; // admin key for writes, search key for reads
  collection: string; // e.g. "messages"
  fetchImpl?: FetchLike; // injectable for tests
  timeoutMs?: number; // default 30s
};

export type IndexedMessage = {
  id: string;
  groupId: string;
  authorUid: string;
  authorDisplayName?: string | null;
  body: string;
  stickerIds?: string[];
  createdAtUnix: number;
  parentMessageId?: string | null;
  moderationState?: string | null;
};

export class TypesenseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TypesenseError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class TypesenseClient {
  private readonly host: string;
  private readonly apiKey: string;
  private readonly collection: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: TypesenseOptions) {
    this.host = opts.host.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.collection = opts.collection;
    // globalThis.fetch is available on Node 20+ (the function runtime).
    this.fetchImpl =
      opts.fetchImpl ?? ((globalThis as { fetch: FetchLike }).fetch as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.host}${path}`, {
        method: init.method,
        headers: {
          "X-TYPESENSE-API-KEY": this.apiKey,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new TypesenseError(
          `Typesense ${init.method} ${path} -> ${res.status}: ${text || "<empty>"}`,
          res.status,
        );
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  upsert(doc: IndexedMessage): Promise<unknown> {
    const path = `/collections/${encodeURIComponent(this.collection)}/documents?action=upsert`;
    return this.request(path, { method: "POST", body: doc });
  }

  async deleteById(id: string): Promise<void> {
    const path = `/collections/${encodeURIComponent(this.collection)}/documents/${encodeURIComponent(id)}`;
    try {
      await this.request(path, { method: "DELETE" });
    } catch (err) {
      // Swallow 404 — deleting an already-absent doc is a no-op for our
      // purposes (e.g. soft-delete event re-delivery, or a hard-delete
      // racing the soft-delete trigger).
      if (err instanceof TypesenseError && err.status === 404) return;
      throw err;
    }
  }

  health(): Promise<unknown> {
    return this.request("/health", { method: "GET" });
  }
}

// ── Process-local circuit breaker (Pattern P8) ───────────────────────────────
//
// Mirrors `services/textModeration.ts` so the two consumers behave the same.
// 5 consecutive failures → open for 5 minutes.

type BreakerState = { failures: number; openedAt: number | null };
const _state: BreakerState = { failures: 0, openedAt: null };

const FAILURES_TO_OPEN = 5;
const OPEN_DURATION_MS = 5 * 60 * 1000;

export function isCircuitOpen(now: number = Date.now()): boolean {
  if (_state.openedAt === null) return false;
  if (now - _state.openedAt > OPEN_DURATION_MS) {
    _state.openedAt = null;
    _state.failures = 0;
    return false;
  }
  return true;
}

export function recordSuccess(): void {
  _state.failures = 0;
  _state.openedAt = null;
}

export function recordFailure(now: number = Date.now()): void {
  _state.failures += 1;
  if (_state.failures >= FAILURES_TO_OPEN) {
    _state.openedAt = now;
  }
}

// Test-only reset.
export function _resetCircuitForTests(): void {
  _state.failures = 0;
  _state.openedAt = null;
}
