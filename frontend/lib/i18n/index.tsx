"use client";

// T61 — i18n foundation.
//
// Two locales for v1: `en` (default) and `es`. The lookup is a simple
// keyed string table with `{varName}` interpolation; missing keys
// surface as the raw key in dev (so a missing string is visually
// obvious) and as the en fallback in production.
//
// Locale resolution order (frontend):
//   1. URL prefix `/en/...` or `/es/...` (Phase 3.5 — deferred)
//   2. `users/{uid}.locale` from the bootstrap response
//   3. `Accept-Language` from the request (server components only)
//   4. Default: en
//
// v1 implements (2) + (4); (1) and (3) are documented in
// `docs/i18n.md` as the next iteration.
//
// `useT()` is the React hook; `t(locale, key, vars)` is the pure
// helper for tests and SSR.

import { type ReactNode, createContext, useCallback, useContext } from "react";

import enMessages from "./messages/en.json";
import esMessages from "./messages/es.json";

export type Locale = "en" | "es";

export const SUPPORTED_LOCALES: Locale[] = ["en", "es"];
export const DEFAULT_LOCALE: Locale = "en";

const TABLES: Record<Locale, Record<string, string>> = {
  en: enMessages as Record<string, string>,
  es: esMessages as Record<string, string>,
};

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/**
 * Pure lookup. Use directly from server components / tests.
 *
 * Resolution: locale → en fallback → raw key.
 */
export function t(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = TABLES[locale] ?? TABLES[DEFAULT_LOCALE];
  if (key in table) return interpolate(table[key], vars);
  if (key in TABLES[DEFAULT_LOCALE]) {
    return interpolate(TABLES[DEFAULT_LOCALE][key], vars);
  }
  if (process.env.NODE_ENV !== "production") {
    return key;
  }
  return key;
}

/**
 * Normalise an arbitrary locale tag (e.g. "es-MX", "EN") to one of
 * SUPPORTED_LOCALES, falling back to DEFAULT_LOCALE.
 */
export function resolveLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const lower = input.toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.includes(lower as Locale)
    ? (lower as Locale)
    : DEFAULT_LOCALE;
}

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * `const t = useT(); t("nav.home")` — resolves against the active
 * locale from `LocaleProvider`. Memo'd so callers can use it in
 * dependency arrays without re-renders.
 */
export function useT(): (
  key: string,
  vars?: Record<string, string | number>,
) => string {
  const locale = useLocale();
  return useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      t(locale, key, vars),
    [locale],
  );
}
