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

import { execSync } from "child_process";
import { existsSync, readdirSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

const standalone = join(".next", "standalone");
const expected = join(standalone, ".next");
const actual = join(standalone, "frontend", ".next");

// Comprehensive debug: find ALL server.js files under .next/
console.log("[fix-standalone] searching for server.js under .next/...");
try {
  const found = execSync("find .next/standalone -name 'server.js' 2>/dev/null || true", { encoding: "utf8" });
  console.log("[fix-standalone] server.js locations:", found.trim() || "(none)");
} catch {}

console.log("[fix-standalone] standalone contents:", existsSync(standalone) ? readdirSync(standalone) : "MISSING");
if (existsSync(actual)) {
  console.log("[fix-standalone] frontend/.next contents:", readdirSync(actual));
}

if (!existsSync(expected) && existsSync(actual)) {
  renameSync(actual, expected);
  console.log("[fix-standalone] moved frontend/.next → .next in standalone");
}

// If server.js was never generated (known Next.js 14 issue with
// outputFileTracingRoot pointing to a parent directory), write it.
const serverJs = join(standalone, "server.js");
if (!existsSync(serverJs)) {
  writeFileSync(
    serverJs,
    `process.env.NODE_ENV = "production";
process.chdir(__dirname);
const { startServer } = require("./node_modules/next/dist/server/lib/start-server");
startServer({
  dir: __dirname,
  isDev: false,
  hostname: process.env.HOSTNAME || "0.0.0.0",
  port: parseInt(process.env.PORT, 10) || 3000,
  allowRetry: false,
  keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10) || undefined,
});
`
  );
  console.log("[fix-standalone] generated missing server.js");
}
