// T53 — strict markdown renderer for chat message bodies.
//
// Allowed inline:  **bold**, *italic*, `code`, ~~strike~~, autolinks.
// Allowed block:   paragraphs, blockquotes (`> `), unordered lists
//                  (`-`/`*`), ordered lists (`1.`).
// Disabled:        headings (`#`), images, raw HTML, tables,
//                  footnotes, definition lists.
//
// All output passes through DOMPurify with a strict allowlist
// (no HTML may slip past the renderer's tokenizer + sanitizer pair).

import DOMPurify from "dompurify";
import { marked } from "marked";

// `marked` exposes a tokenizer-level disable for the constructs we
// don't want. Headings and HTML get the strictest treatment because
// they're the easy ways someone types `<script>` or `# admin only`
// and surprises the reader.
const _renderer = new marked.Renderer();
_renderer.heading = ({ text }) => `<p>${text}</p>`;
_renderer.html = () => ""; // raw HTML stripped at the renderer level
_renderer.image = () => ""; // images disallowed (T53 spec)
_renderer.link = ({ href, text }) => {
  // marked sometimes returns href as null/undefined when the URL is
  // malformed; render the text without a link in that case.
  const safe = typeof href === "string" ? href : "";
  if (!safe) return text;
  // Only http(s) and mailto link out; anything else (javascript:, data:)
  // gets stripped to text.
  const lower = safe.toLowerCase();
  if (
    !lower.startsWith("http://") &&
    !lower.startsWith("https://") &&
    !lower.startsWith("mailto:")
  ) {
    return text;
  }
  return `<a href="${escapeAttribute(safe)}" rel="noopener noreferrer" target="_blank">${text}</a>`;
};

marked.use({
  renderer: _renderer,
  gfm: true,
  breaks: true, // newlines → <br>; matches chat conventions
});

const _purifyConfig = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "code",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "del",
    "s",
  ],
  ALLOWED_ATTR: ["href", "rel", "target"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// `marked.use({ renderer })` wires the link override but the GFM
// autolink path takes a separate fast route that skips it. Force
// every <a> through the same hardening at sanitize time so autolinks
// match explicit link rendering exactly.
let _hookInstalled = false;
function ensureLinkHardeningHook(): void {
  if (_hookInstalled) return;
  // jsdom shims may omit `addHook`; fall back gracefully.
  if (typeof DOMPurify.addHook !== "function") {
    _hookInstalled = true;
    return;
  }
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if ((node as Element).tagName === "A") {
      (node as Element).setAttribute("rel", "noopener noreferrer");
      (node as Element).setAttribute("target", "_blank");
    }
  });
  _hookInstalled = true;
}

/**
 * Render a chat message body as sanitized HTML. Idempotent and pure.
 * Empty input returns the empty string (callers can render the
 * empty body slot however they like).
 */
export function renderMarkdownToHtml(body: string): string {
  if (!body) return "";
  ensureLinkHardeningHook();
  const html = marked.parse(body, { async: false }) as string;
  // The DOMPurify config above is the canonical second filter; nothing
  // outside the allowlist can survive it.
  return DOMPurify.sanitize(html, _purifyConfig);
}
