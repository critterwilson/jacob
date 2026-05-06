// Long-form markdown renderer for static, author-controlled content
// (legal pages — Privacy, Terms, Community Guidelines).
//
// Why a separate renderer: lib/markdown.ts is the chat sanitizer; it
// strips headings, images, and raw HTML because chat bodies are
// untrusted user input. Legal documents are the opposite — author-
// written, version-controlled markdown that needs headings, lists,
// links, and structure. The two have nothing to share beyond the
// underlying `marked` parser.
//
// DOMPurify is intentionally NOT used here. Input comes from .md
// files in `frontend/content/legal/`, reviewed in-PR like any other
// source file. There is no user-supplied content path to this
// renderer. Adding DOMPurify would require an isomorphic shim
// (jsdom on the server) for no security gain.

import { Marked, Renderer } from "marked";

const _renderer = new Renderer();

// Lock down link rendering: only http(s) + mailto. Anything else
// (javascript:, data:, etc.) renders as plain text.
_renderer.link = ({ href, text }) => {
  const safe = typeof href === "string" ? href : "";
  if (!safe) return text;
  const lower = safe.toLowerCase();
  if (
    !lower.startsWith("http://") &&
    !lower.startsWith("https://") &&
    !lower.startsWith("mailto:") &&
    !lower.startsWith("/")
  ) {
    return text;
  }
  const isInternal = lower.startsWith("/");
  const attrs = isInternal
    ? ""
    : ' rel="noopener noreferrer" target="_blank"';
  return `<a href="${escapeAttribute(safe)}"${attrs}>${text}</a>`;
};

// Strip raw HTML defensively even though authored content shouldn't
// contain any. Cheap insurance against a typo.
_renderer.html = () => "";
_renderer.image = () => "";

const _instance = new Marked({
  renderer: _renderer,
  gfm: true,
  breaks: false, // long-form prose: paragraph breaks come from blank lines
});

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Render a long-form markdown document (privacy policy, terms,
 * guidelines) to HTML. Synchronous, pure, server-safe.
 *
 * The output is meant to be wrapped in a container that applies
 * design-system styling via descendant selectors (see
 * components/legal/LegalDocument.tsx).
 */
export function renderLegalMarkdown(body: string): string {
  if (!body) return "";
  return _instance.parse(body, { async: false }) as string;
}
