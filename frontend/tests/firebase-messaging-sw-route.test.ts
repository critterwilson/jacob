/**
 * @vitest-environment node
 *
 * The Firebase Messaging service worker is served by a Next.js route
 * handler so its Firebase config can be inlined synchronously at the
 * SW's top level. If the config were ever moved back behind an async
 * fetch/postMessage, iOS Safari would silently drop background pushes
 * during cold SW starts — the bug this whole route exists to fix.
 *
 * The asserts below pin the invariants future authors are likeliest to
 * accidentally break.
 */
import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  // The route reads NEXT_PUBLIC_FIREBASE_* at request time. In CI the
  // real values may or may not be present; force a known-good set so
  // the test is deterministic and the projectId assertion below has
  // something distinctive to look for.
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "test.firebaseapp.com";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project-id";
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "test.firebasestorage.app";
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "1234567890";
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "1:1234567890:web:abc";
});

async function fetchSw(): Promise<{ status: number; headers: Headers; body: string }> {
  const { GET } = await import("@/app/firebase-messaging-sw.js/route");
  const res = await GET();
  return { status: res.status, headers: res.headers, body: await res.text() };
}

describe("GET /firebase-messaging-sw.js", () => {
  it("serves JavaScript with the SW-friendly headers", async () => {
    const { status, headers } = await fetchSw();
    expect(status).toBe(200);
    expect(headers.get("content-type")).toMatch(/application\/javascript/);
    expect(headers.get("service-worker-allowed")).toBe("/");
    // Must not be cached aggressively — SWs need to be free to update.
    expect(headers.get("cache-control")).toMatch(/no-cache|no-store/);
  });

  it("calls firebase.initializeApp synchronously at top level (not behind a fetch)", async () => {
    const { body } = await fetchSw();
    // Same-line synchronous call. If a future edit puts initializeApp
    // inside a `.then(...)`, a `fetch(...).then(initializeApp)` would
    // make this test still pass — so additionally assert the call is
    // not preceded on the same line by `.then(` or `await `.
    const initLines = body
      .split("\n")
      .filter((l) => l.includes("firebase.initializeApp("));
    expect(initLines.length).toBeGreaterThan(0);
    for (const line of initLines) {
      expect(line).not.toMatch(/\.then\s*\(/);
      expect(line.trim().startsWith("firebase.initializeApp(")).toBe(true);
    }
  });

  it("calls firebase.messaging() and registers onBackgroundMessage", async () => {
    const { body } = await fetchSw();
    expect(body).toMatch(/firebase\.messaging\(\)/);
    expect(body).toMatch(/onBackgroundMessage\s*\(/);
    expect(body).toMatch(/showNotification\s*\(/);
  });

  it("inlines the per-environment projectId", async () => {
    const { body } = await fetchSw();
    expect(body).toContain("test-project-id");
    expect(body).toContain("test-api-key");
  });

  it("does not depend on /__/firebase/init.json", async () => {
    const { body } = await fetchSw();
    // The bug we just fixed: the legacy SW fetched config from this
    // classic-Firebase-Hosting-only endpoint, which App Hosting never
    // serves. If a future change reintroduces this path, the SW will
    // be racing the first push event again.
    expect(body).not.toContain("/__/firebase/init.json");
    expect(body).not.toContain("/__/firebase/init.js");
  });

  it("does not rely on a postMessage handshake to initialize messaging", async () => {
    const { body } = await fetchSw();
    expect(body).not.toContain("FIREBASE_CONFIG");
    expect(body).not.toMatch(/addEventListener\(\s*["']message["']/);
  });
});
