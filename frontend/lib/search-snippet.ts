/**
 * Escape a search snippet for safe HTML rendering.
 *
 * Native Firestore search (ADR 0016) returns the raw message body — no
 * Typesense `<mark>` wrappers — so the only job here is to neutralise
 * user-supplied HTML. `sanitiseSnippet` is kept as the public name
 * because the call site stays the same.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

export function sanitiseSnippet(snippet: string): string {
  return escapeHtml(snippet);
}
