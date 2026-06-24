// ─────────────────────────────────────────────────────────────────────────
// Brand name — single source of truth for the app's user-facing name.
//
// PROVISIONAL: "Olivet" is a placeholder pending Christopher's final
// choice. Shortlist from the Olive Branch rebrand: Olivet / Branch / Selah.
// Change this ONE constant to rename the app across every user-facing
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
// the two in sync when the final name is picked.
// ─────────────────────────────────────────────────────────────────────────

export const BRAND_NAME = "Olivet";

// One-line product promise, reused in metadata + the PWA manifest.
export const BRAND_DESCRIPTION =
  "A quiet place for your small group, between Sundays.";
