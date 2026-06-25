// ─────────────────────────────────────────────────────────────────────────
// Brand name — single source of truth for the app's user-facing name.
//
// "Branch" is the final chosen name (Olive Branch rebrand). It carries a
// triple resonance: "the Branch" as a messianic title (Jeremiah 23:5), the
// olive *branch* of peace, and a small group as a *branch* of the larger
// body. Change this ONE constant to rename the app across every user-facing
// surface (titles, wordmark, manifest, prompts, validation copy, legal
// docs). Do NOT hard-code the brand name anywhere else — import this.
//
// Internal-only identifiers intentionally keep the legacy "jacob" token
// and are NOT routed through here: the `x-jacob-org-*` HTTP headers,
// `JACOB_*` env vars, the `demo-jacob` Firestore project id, and pnpm
// package names. Renaming those is a separate, churny, non-user-facing
// follow-up.
//
// The backend keeps its own mirror of this value (see
// backend/app/config.py `brand_name`) used for transactional email; keep
// the two in sync.
// ─────────────────────────────────────────────────────────────────────────

export const BRAND_NAME = "Branch";

// One-line product promise, reused in metadata + the PWA manifest.
export const BRAND_DESCRIPTION =
  "A quiet place for your small group, between Sundays.";
