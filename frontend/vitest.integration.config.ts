/**
 * Vitest config for the M9 emulator-backed integration tests.
 *
 * Default `pnpm test` (vitest.config.ts) excludes `**\/integration/**`.
 * This config enables them and points at the running Firestore
 * emulator on 127.0.0.1:8080 (the standard JACOB emulator port).
 *
 * Run via:
 *   firebase emulators:exec --only auth,firestore --project demo-jacob \
 *     "pnpm --filter jacob-frontend exec vitest run --config vitest.integration.config.ts"
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
