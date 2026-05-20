/**
 * App Hosting pnpm workspace standalone fix.
 *
 * When experimental.outputFileTracingRoot points to the workspace root
 * (/workspace/), Next.js places build artefacts at
 * .next/standalone/frontend/.next/ instead of .next/standalone/.next/.
 *
 * The @apphosting/adapter-nextjs expects .next/standalone/.next/ and
 * google.nodejs.firebasebundle expects server.js to be co-located with
 * a real .next/ directory (a symlink confuses the buildpack and causes
 * server.js to be excluded from the container image).
 *
 * Fix: rename (move) frontend/.next/ to .next/ inside the standalone.
 * This restores the standard structure so both the adapter and buildpack
 * behave identically to a non-workspace build.
 *
 * Only runs when the shifted structure is detected; a standard build
 * (where .next/standalone/.next/ already exists as a real dir) is a no-op.
 */

/**
 * With experimental.outputFileTracingRoot=/workspace/, Next.js 14 places
 * build artefacts relative to the workspace root inside the standalone:
 *
 *   .next/standalone/
 *     frontend/
 *       server.js       ← the real standalone entry (traced, deps included)
 *       .next/          ← app build artefacts
 *     node_modules/     ← traced deps including next (workspace-level)
 *     package.json      ← workspace package.json
 *
 * The @apphosting/adapter-nextjs expects:
 *   .next/standalone/server.js
 *   .next/standalone/.next/routes-manifest.json
 *
 * Fix: move both files/dirs to the expected locations so the adapter's
 * loadRouteManifest step and the container's startCommand both work.
 *
 * Using renameSync (atomic, no copy) for the .next dir.
 * For server.js we must MOVE the real generated file — not create our own —
 * because only the traced server.js has all its require() targets included
 * in the standalone's node_modules.
 */

import { existsSync, readdirSync, renameSync, symlinkSync } from "fs";
import { join } from "path";

const standalone = join(".next", "standalone");

// --- 1. Move server.js from frontend/ to standalone root ---
const serverJsDest = join(standalone, "server.js");
const serverJsSrc = join(standalone, "frontend", "server.js");

if (!existsSync(serverJsDest) && existsSync(serverJsSrc)) {
  renameSync(serverJsSrc, serverJsDest);
  console.log("[fix-standalone] moved frontend/server.js → server.js");
}

// --- 2. Move .next/ artefacts from frontend/.next to standalone root ---
const dotNextDest = join(standalone, ".next");
const dotNextSrc = join(standalone, "frontend", ".next");

if (!existsSync(dotNextDest) && existsSync(dotNextSrc)) {
  renameSync(dotNextSrc, dotNextDest);
  console.log("[fix-standalone] moved frontend/.next → .next");
}

// --- 3. Symlink node_modules/next so server.js can resolve require('next') ---
// With outputFileTracingRoot=/workspace/, pnpm only symlinks 'next' under
// standalone/frontend/node_modules/ (traced from frontend/node_modules/).
// After moving server.js to the standalone root, Node.js looks for 'next' in
// standalone/node_modules/ where no symlink exists. Create one pointing into
// the .pnpm store that was already traced.
const nextLink = join(standalone, "node_modules", "next");
const pnpmDir = join(standalone, "node_modules", ".pnpm");

if (!existsSync(nextLink) && existsSync(pnpmDir)) {
  const nextEntry = readdirSync(pnpmDir).find((e) => e.startsWith("next@"));
  if (nextEntry) {
    const target = join(".pnpm", nextEntry, "node_modules", "next");
    symlinkSync(target, nextLink, "dir");
    console.log(`[fix-standalone] created node_modules/next → ${target}`);
  } else {
    console.warn("[fix-standalone] WARNING: could not find next@ entry under .pnpm");
  }
}
