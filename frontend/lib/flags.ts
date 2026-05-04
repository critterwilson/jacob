// Feature-flag client (T58).
//
// Pattern: one fetch of `GET /api/flags` per browser session, revalidated
// on focus and on a 60-second background interval. Components consume
// `useFlag('mobile_native_enabled')` and re-render when the cached map
// changes. The 60-second propagation budget is deliberate — see
// `docs/runbooks/feature-flags.md` for the trade against the spec's
// 5-second target (post-M6 we don't have a Firestore listener path).
//
// SSR callers can import `evaluateFlag(flags, key)` and pass a map they
// fetched server-side from the same endpoint.

"use client";

import { useEffect, useState } from "react";

import { ApiError, apiGet } from "@/lib/api";

const REVALIDATE_INTERVAL_MS = 60_000;

type FlagsResponse = { flags: Record<string, boolean> };

let _cache: Record<string, boolean> | null = null;
let _cacheAt = 0;
let _inflight: Promise<Record<string, boolean>> | null = null;
const _subscribers = new Set<() => void>();
let _revalidateTimer: ReturnType<typeof setInterval> | null = null;

function notify(): void {
  _subscribers.forEach((cb) => cb());
}

async function fetchFlags(): Promise<Record<string, boolean>> {
  if (_inflight) return _inflight;
  _inflight = apiGet<FlagsResponse>("/api/flags")
    .then((res) => {
      _cache = res.flags ?? {};
      _cacheAt = Date.now();
      _inflight = null;
      notify();
      return _cache;
    })
    .catch((err: unknown) => {
      _inflight = null;
      // 401 means the user is signed out; suppress noisy console output.
      if (err instanceof ApiError && err.status !== 401) {
        console.warn("flags_load_failed", err.code, err.status);
      }
      // Fail-safe: return whatever we already had (or an empty map). A
      // missing key always evaluates false, so unknown surfaces stay off.
      const fallback = _cache ?? {};
      _cache = fallback;
      notify();
      return fallback;
    });
  return _inflight;
}

function ensureRevalidateTimer(): void {
  if (_revalidateTimer || typeof window === "undefined") return;
  _revalidateTimer = setInterval(() => {
    if (_subscribers.size > 0) {
      void fetchFlags();
    }
  }, REVALIDATE_INTERVAL_MS);
}

export function useFlag(key: string): boolean {
  const [value, setValue] = useState<boolean>(() =>
    _cache ? Boolean(_cache[key]) : false,
  );

  useEffect(() => {
    const cb = () => {
      setValue(_cache ? Boolean(_cache[key]) : false);
    };
    _subscribers.add(cb);
    ensureRevalidateTimer();

    if (!_cache || Date.now() - _cacheAt > REVALIDATE_INTERVAL_MS) {
      void fetchFlags();
    } else {
      cb();
    }

    return () => {
      _subscribers.delete(cb);
    };
  }, [key]);

  return value;
}

export function useFlags(): { flags: Record<string, boolean>; loading: boolean } {
  const [snapshot, setSnapshot] = useState<{
    flags: Record<string, boolean>;
    loading: boolean;
  }>(() => ({
    flags: _cache ?? {},
    loading: _cache === null,
  }));

  useEffect(() => {
    const cb = () => {
      setSnapshot({ flags: _cache ?? {}, loading: false });
    };
    _subscribers.add(cb);
    ensureRevalidateTimer();
    if (!_cache) {
      void fetchFlags();
    } else {
      cb();
    }
    return () => {
      _subscribers.delete(cb);
    };
  }, []);

  return snapshot;
}

export function evaluateFlag(
  flags: Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  return Boolean(flags && flags[key]);
}

// Test-only: drop the module-level cache so suites can reset between cases.
// Not exported via the package boundary; callers that rely on it should
// import from `@/lib/flags` and accept the contract may shift.
export function __resetFlagCacheForTests(): void {
  _cache = null;
  _cacheAt = 0;
  _inflight = null;
  if (_revalidateTimer) {
    clearInterval(_revalidateTimer);
    _revalidateTimer = null;
  }
  _subscribers.clear();
}
