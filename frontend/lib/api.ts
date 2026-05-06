// Typed fetch wrapper introduced for M1 of the data-layer migration
// (docs/data-layer-migration-plan.md §7.1). Every later phase routes its
// reads through this module, so the retry / abort / error semantics here
// are load-bearing.
//
// Behaviour:
//   * Authorization header is attached automatically when a Firebase user
//     is signed in.
//   * Errors come back as `ApiError` with the backend's typed `{code, message}`
//     payload preserved; transport failures surface as one of:
//       - `cors_blocked` — cross-origin fetch failed at the browser, almost
//         always a missing CORS header on the server. Promoted from the
//         generic `network_error` after that bucket misled M1 CORS triage.
//       - `network_error` — same-origin transport failure (DNS, offline,
//         server unreachable) or any non-TypeError surface.
//   * Retry policy (exponential backoff, 200ms then 400ms):
//       - Transport failures (fetch threw, not CORS) retry on every
//         method up to `opts.retry`. Default `opts.retry` is 2 for GET
//         and 0 for everything else, so non-GET verbs only retry transport
//         failures when the caller explicitly opts in.
//       - 5xx + 429 response statuses retry on every method too — but the
//         non-GET defaults of 0 mean a POST/PATCH/DELETE that gets a 5xx
//         response surfaces it after the first attempt, since a server-
//         acknowledged failure could still have committed.
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

// Heuristic: a `TypeError` thrown by `fetch` to a *cross-origin* URL is
// almost always a CORS preflight rejection (or missing CORS headers on the
// real response). Same-origin TypeErrors are genuine transport failures.
// Browsers deliberately make CORS errors indistinguishable from network
// errors at the JS level — the origin check is the best signal we have.
function isLikelyCorsError(e: unknown, url: string): boolean {
  if (typeof window === "undefined") return false;
  if (!(e instanceof TypeError)) return false;
  try {
    const target = new URL(url, window.location.href);
    return target.origin !== window.location.origin;
  } catch {
    return false;
  }
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

// FormData bodies are passed straight to fetch — the browser sets the
// Content-Type (with the multipart boundary) automatically. We must NOT
// set Content-Type ourselves; doing so omits the boundary and the server
// rejects the body. JSON bodies still get the explicit Content-Type.
function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

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

  const formDataBody = isFormData(body);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) {
      throw new ApiError(0, "aborted", "Request aborted");
    }

    const headers: Record<string, string> = {
      ...authH,
      Accept: "application/json",
    };
    if (body !== undefined && !formDataBody) {
      headers["Content-Type"] = "application/json";
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : formDataBody
              ? (body as FormData)
              : JSON.stringify(body),
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
      // CORS failures are not retryable — the server config is wrong, retrying
      // burns time without changing the outcome and muddies the diagnostic.
      if (isLikelyCorsError(e, url)) {
        throw new ApiError(
          0,
          "cors_blocked",
          `Cross-origin request to ${url} was blocked. ` +
            "This usually means the server is missing CORS headers " +
            "or rejected a preflight OPTIONS request.",
        );
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

/**
 * Result of a conditional GET. `status === 304` means the server affirmed
 * the cached body via `If-None-Match` and `data` is null. Otherwise `status`
 * is 200 and `data` carries the parsed body. The `etag` (when present) is
 * the value to send back as `If-None-Match` on the next poll.
 */
export type ConditionalGetResult<T> =
  | { status: 200; data: T; etag: string | null }
  | { status: 304; data: null; etag: string | null };

/**
 * GET with `If-None-Match` support. Returns 200+body when content changed
 * (or no etag was sent), 304+null when the server matched the etag. Used by
 * the chat-message poll loop to short-circuit unchanged responses.
 *
 * Same retry / abort / CORS behaviour as `apiGet`. Auth header attached
 * automatically.
 */
export async function apiGetConditional<T>(
  path: string,
  ifNoneMatch: string | null,
  opts: ApiRequestOpts = {},
): Promise<ConditionalGetResult<T>> {
  const url = resolveUrl(path);
  const maxRetries = opts.retry !== undefined ? opts.retry : 2;
  let attempt = 0;

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
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers,
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
      if (isLikelyCorsError(e, url)) {
        throw new ApiError(
          0,
          "cors_blocked",
          `Cross-origin request to ${url} was blocked.`,
        );
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

    const etag = res.headers.get("ETag");
    if (res.status === 304) {
      return { status: 304, data: null, etag };
    }
    if (res.ok) {
      const data = (await res.json()) as T;
      return { status: 200, data, etag };
    }
    if (shouldRetry(res.status) && attempt < maxRetries) {
      await delay(200 * 2 ** attempt, opts.signal);
      attempt++;
      continue;
    }
    throw await parseError(res);
  }
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
