import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    passWithNoTests: true,
    // M9 emulator tests live alongside the rest of the test tree but
    // require a running emulator and are run via a separate config
    // (`vitest.integration.config.ts`) inside `firebase emulators:exec`.
    // Playwright E2E specs in `e2e/` use `@playwright/test`, not vitest —
    // they must be excluded so vitest doesn't trip on `test.describe`.
    exclude: ["**/node_modules/**", "**/integration/**", "**/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
