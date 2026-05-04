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
    exclude: ["**/node_modules/**", "**/integration/**"],
    // Use forked processes per test file so a leaky test (currently
    // tests/chat.test.tsx — the MessageInput + MessageItem + MessageList
    // mix that combines `vi.resetModules()`, react-hook-form, and
    // mocked apiPost) can't OOM the whole worker. M4 hit this on both
    // local Node 25 and CI Node 20.
    pool: "vmThreads",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
