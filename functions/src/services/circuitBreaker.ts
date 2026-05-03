/**
 * Generic process-local circuit breaker factory (P8).
 *
 * Each service creates its own instance via `createCircuitBreaker()` so
 * failures in one service don't trip the breaker for another.
 *
 * The 5-minute open window is short enough that a recovered Cloud Run
 * instance (or a new cold-start container) retries quickly.
 */

export type CircuitBreaker = {
  isOpen: (now?: number) => boolean;
  recordSuccess: () => void;
  recordFailure: (now?: number) => void;
  /** Test-only reset. */
  _reset: () => void;
};

export function createCircuitBreaker(
  failuresToOpen = 5,
  openDurationMs = 5 * 60 * 1000,
): CircuitBreaker {
  let failures = 0;
  let openedAt: number | null = null;

  return {
    isOpen(now = Date.now()) {
      if (openedAt === null) return false;
      if (now - openedAt > openDurationMs) {
        openedAt = null;
        failures = 0;
        return false;
      }
      return true;
    },
    recordSuccess() {
      failures = 0;
      openedAt = null;
    },
    recordFailure(now = Date.now()) {
      failures += 1;
      if (failures >= failuresToOpen) {
        openedAt = now;
      }
    },
    _reset() {
      failures = 0;
      openedAt = null;
    },
  };
}
