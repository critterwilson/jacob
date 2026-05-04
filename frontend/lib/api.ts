// Typed fetch wrapper introduced for M1 of the data-layer migration
// (docs/data-layer-migration-plan.md §7.1). Every later phase routes its
// reads through this module, so the retry / abort / error semantics here
// are load-bearing.
//
// Behaviour:
//   * Authorization header is attached automatically when a Firebase user
//     is signed in.
//   * Errors come back as `ApiError` with the backend's typed `{code, message}`
//     payload preserved; transport failures surface as a generic
//     `network_error` ApiError so callers always pattern-match on `.code`.
//   * 5xx responses and transient network failures are retried with
//     exponential backoff (200ms, 400ms) for idempotent verbs (GET).
//     POST / PATCH / DELETE retries are opt-in via `opts.retry`.
//   * AbortSignal is honoured: aborts surface as `ApiError(0, "aborted", ...)`.

import { auth } from "@/lib/firebase";

// In production the frontend and backend are colocated under the same
// origin (Cloud Run + Firebase Hosting rewrite), so an empty base means
// "same origin". For local dev `NEXT_PUBLIC_API_URL=http://localhost:8000`
// matches the convention already used by other hooks (useSearch, etc.).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type ApiBackendError = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiRequestOpts = {
  signal?: AbortSignal;
  // Override retry behaviour. Defaults: 2 retries on GET, 0 on others.
  retry?: number;
};

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    // Auth state can flip between the check and the token mint (sign-out,
    // network blip). Behave as if the user weren't signed in — the backend
    // will return 401 and the caller can decide what to do.
    return {};
  }
}

function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function parseError(r: Response): Promise<ApiError> {
  let payload: { error?: ApiBackendError } = {};
  try {
    payload = await r.json();
  } catch {
    // Non-JSON error bodies (proxies, gateway errors) — fall back to status.
  }
  const err = payload.error;
  return new ApiError(
    r.status,
    err?.code ?? "unknown",
    err?.message ?? r.statusText ?? `HTTP ${r.status}`,
    err?.details,
  );
}

function shouldRetry(status: number): boolean {
  // 5xx and 429. 502/503/504 in particular are common Cloud Run cold-start
  // transients worth a retry; 500s are rarer but cheap to retry once.
  return status >= 500 || status === 429;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError(0, "aborted", "Request aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ApiError(0, "aborted", "Request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(
  method: Method,
  path: string,
  body: unknown,
  opts: ApiRequestOpts,
): Promise<T> {
  const url = resolveUrl(path);
  const maxRetries =
    opts.retry !== undefined ? opts.retry : method === "GET" ? 2 : 0;
  let attempt = 0;

  // Build the auth header once per logical call. The Firebase SDK caches
  // tokens and refreshes them itself, so re-fetching on retry is wasteful.
  const authH = await authHeader();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) {
      throw new ApiError(0, "aborted", "Request aborted");
    }

    const headers: Record<string, string> = {
      ...authH,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: opts.signal,
        credentials: "include",
      });
    } catch (e) {
      if (
        e instanceof DOMException &&
        (e.name === "AbortError" || e.name === "TimeoutError")
      ) {
        throw new ApiError(0, "aborted", "Request aborted");
      }
      if (attempt < maxRetries) {
        await delay(200 * 2 ** attempt, opts.signal);
        attempt++;
        continue;
      }
      throw new ApiError(
        0,
        "network_error",
        e instanceof Error ? e.message : "Network request failed",
      );
    }

    if (res.ok) {
      // 204 No Content → caller still gets a typed value; cast empty object.
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    if (shouldRetry(res.status) && attempt < maxRetries) {
      await delay(200 * 2 ** attempt, opts.signal);
      attempt++;
      continue;
    }
    throw await parseError(res);
  }
}

export function apiGet<T>(path: string, opts: ApiRequestOpts = {}): Promise<T> {
  return request<T>("GET", path, undefined, opts);
}

export function apiPost<T, B = unknown>(
  path: string,
  body: B,
  opts: ApiRequestOpts = {},
): Promise<T> {
  return request<T>("POST", path, body, opts);
}

export function apiPut<T, B = unknown>(
  path: string,
  body: B,
  opts: ApiRequestOpts = {},
): Promise<T> {
  return request<T>("PUT", path, body, opts);
}

export function apiPatch<T, B = unknown>(
  path: string,
  body: B,
  opts: ApiRequestOpts = {},
): Promise<T> {
  return request<T>("PATCH", path, body, opts);
}

export function apiDelete<T = void>(
  path: string,
  opts: ApiRequestOpts = {},
): Promise<T> {
  return request<T>("DELETE", path, undefined, opts);
}
