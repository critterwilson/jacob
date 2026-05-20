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

import { existsSync, readdirSync, renameSync } from "fs";
import { join } from "path";

const standalone = join(".next", "standalone");
const expected = join(standalone, ".next");
const actual = join(standalone, "frontend", ".next");

// Debug: log what's in standalone right now
console.log("[fix-standalone] standalone contents:", existsSync(standalone) ? readdirSync(standalone) : "MISSING");
console.log("[fix-standalone] server.js exists:", existsSync(join(standalone, "server.js")));
console.log("[fix-standalone] .next exists:", existsSync(expected));
console.log("[fix-standalone] frontend/.next exists:", existsSync(actual));

if (!existsSync(expected) && existsSync(actual)) {
  // renameSync is atomic on the same filesystem — no copy overhead.
  renameSync(actual, expected);
  console.log("[fix-standalone] moved frontend/.next → .next in standalone");
  console.log("[fix-standalone] standalone contents after:", readdirSync(standalone));
}
