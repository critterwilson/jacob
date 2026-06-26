"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Light / dark theme system.
 *
 * Three user-facing choices: "light", "dark", or "system" (follow the OS
 * `prefers-color-scheme`). The choice is persisted in localStorage under
 * STORAGE_KEY and applied by toggling the `data-theme` attribute on
 * <html>:
 *   - "light" / "dark" → set data-theme explicitly.
 *   - "system"         → remove the attribute and let the CSS media query
 *                        in styles/tokens.css resolve the palette.
 *
 * A tiny inline script (themeInitScript, injected in app/layout.tsx <head>)
 * applies the explicit choice BEFORE first paint so there is no flash. This
 * provider then reconciles on mount and keeps the <meta name="theme-color">
 * in sync with the resolved ground colour.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "branch-theme";

// Ground colours (must match --color-ink in styles/tokens.css). Used for the
// browser/PWA chrome `theme-color` meta so the status bar matches the page.
const GROUND: Record<ResolvedTheme, string> = {
  light: "#d9c3ac",
  dark: "#241310",
};

/**
 * Inline, render-blocking script that sets data-theme from the persisted
 * choice before the document paints. Stringified into a <script> in the
 * document head. Kept dependency-free and wrapped in try/catch so a
 * storage exception (private mode, disabled cookies) never blocks render.
 */
export const themeInitScript = `(()=>{try{var c=localStorage.getItem("${STORAGE_KEY}");if(c==="light"||c==="dark"){document.documentElement.setAttribute("data-theme",c);}}catch(e){}})();`;

type ThemeContextValue = {
  /** The user's choice, including "system". */
  theme: ThemeChoice;
  /** The concrete palette in effect right now. */
  resolvedTheme: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const c = window.localStorage.getItem(STORAGE_KEY);
    if (c === "light" || c === "dark") return c;
  } catch {
    /* ignore */
  }
  return "system";
}

function applyChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

function syncMeta(resolved: ResolvedTheme): void {
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", GROUND[resolved]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start from "system" on both server and first client render so hydration
  // matches; the real choice is read in the mount effect below. (The inline
  // script has already applied the correct data-theme, so there is no
  // visual flash regardless of this initial state.)
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [systemDark, setSystemDark] = useState(false);

  // Reconcile with storage + OS on mount.
  useEffect(() => {
    setThemeState(readStoredChoice());
    setSystemDark(systemPrefersDark());
  }, []);

  // Track OS preference changes (affects the resolved theme only while the
  // user is on "system").
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Keep the DOM attribute + theme-color meta in lockstep with state.
  useEffect(() => {
    applyChoice(theme);
    syncMeta(resolvedTheme);
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((choice: ThemeChoice) => {
    setThemeState(choice);
    try {
      if (choice === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, choice);
      }
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Fallback used when a theme-aware control is rendered outside the
 * ThemeProvider (e.g. an isolated unit test, or a surface that has not yet
 * been wrapped). It degrades gracefully — applying the choice straight to
 * the document and localStorage — rather than throwing, so the toggle never
 * crashes a tree. In the app the provider is always mounted at the root.
 */
function useThemeFallback(): ThemeContextValue {
  return useMemo(
    () => ({
      theme: "system",
      resolvedTheme: "light",
      setTheme: (choice: ThemeChoice) => {
        if (typeof document === "undefined") return;
        applyChoice(choice);
        try {
          if (choice === "system") {
            window.localStorage.removeItem(STORAGE_KEY);
          } else {
            window.localStorage.setItem(STORAGE_KEY, choice);
          }
        } catch {
          /* ignore */
        }
      },
    }),
    [],
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const fallback = useThemeFallback();
  return ctx ?? fallback;
}
