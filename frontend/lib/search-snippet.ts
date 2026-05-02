/**
 * T28 — sanitise a Typesense highlight snippet for safe HTML rendering.
 *
 * Typesense's `highlight` field wraps matched substrings in `<mark>...</mark>`
 * (no other tags, no attributes). The rest of the snippet is the message
 * body — verbatim user input.
 *
 * Strategy:
 *   1. HTML-escape the entire snippet first, so any user-supplied `<script>`,
 *      `<img onerror=...>`, etc. is neutralised.
 *   2. Then re-introduce ONLY the literal `<mark>` / `</mark>` pair by
 *      undoing the escape on those exact substrings.
 *
 * This is intentionally simpler (and stricter) than reaching for DOMPurify,
 * because our allowlist is exactly two tags with no attributes — no general-
 * purpose HTML parser is required.
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

/**
 * Sanitise a snippet from Typesense `highlight.body.snippet`.
 *
 * Output is safe to render via `dangerouslySetInnerHTML`. The only
 * tags that survive are `<mark>` and `</mark>`.
 */
export function sanitiseSnippet(snippet: string): string {
  const escaped = escapeHtml(snippet);
  return escaped.replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
}
