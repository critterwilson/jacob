"use client";

/**
 * Frontend Sentry initialisation.
 *
 * Call `initSentry()` once at application startup (e.g. in a root layout or
 * _app component). Initialisation is skipped when NEXT_PUBLIC_SENTRY_DSN is
 * unset, so local development and tests are unaffected by default.
 *
 * PII scrubbing applied via beforeSend:
 *   - Email addresses in exception messages are replaced with "[email]".
 *   - Request body, cookies, and the Authorization/Cookie headers are stripped.
 */

import * as Sentry from "@sentry/nextjs";

const EMAIL_RE = /[a-zA-Z0-9_.+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-.]+/g;

function scrubEmails(value: string): string {
  return value.replace(EMAIL_RE, "[email]");
}

function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Scrub emails from exception messages
  for (const exc of event.exception?.values ?? []) {
    if (exc.value) {
      exc.value = scrubEmails(exc.value);
    }
  }

  // Strip request body and sensitive headers
  if (event.request) {
    delete (event.request as Record<string, unknown>).data;
    delete (event.request as Record<string, unknown>).cookies;
    const headers = event.request.headers as Record<string, string> | undefined;
    if (headers) {
      delete headers["Authorization"];
      delete headers["authorization"];
      delete headers["Cookie"];
      delete headers["cookie"];
    }
  }

  return event;
}

export function initSentry(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  const rawRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  const tracesSampleRate = rawRate !== undefined ? parseFloat(rawRate) : 0.1;

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate,
    beforeSend,
    sendDefaultPii: false,
  });
}

export { Sentry };
