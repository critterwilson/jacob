/**
 * App Hosting pnpm workspace standalone fix.
 *
 * When experimental.outputFileTracingRoot points to the workspace root
 * (/workspace/), Next.js places build artefacts at
 * .next/standalone/frontend/.next/ instead of .next/standalone/.next/.
 * The @apphosting/adapter-nextjs expects .next/standalone/.next/, so
 * this script creates a relative symlink to bridge the gap.
 *
 * Only runs when the shifted structure is detected; a standard build
 * (where .next/standalone/.next/ already exists as a real dir) is a no-op.
 */

import { existsSync, symlinkSync } from "fs";
import { join } from "path";

const standalone = join(".next", "standalone");
const expected = join(standalone, ".next");
const actual = join(standalone, "frontend", ".next");

if (!existsSync(expected) && existsSync(actual)) {
  // Relative symlink so it stays valid inside the container image.
  symlinkSync(join("frontend", ".next"), expected, "dir");
  console.log("[fix-standalone] created .next → frontend/.next in standalone");
}
