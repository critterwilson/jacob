/**
 * @vitest-environment node
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// `middleware.ts` calls fetch (for /api/by-host org resolution). Stub it
// so it returns a non-OK response — the org branch is irrelevant here;
// these tests focus on the onboarding gate.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({
    ok: false,
    json: async () => ({}),
  })),
);

import { middleware } from "@/middleware";

function buildRequest(path: string, hasProfile: boolean): NextRequest {
  const url = `https://app.jacob.app${path}`;
  const cookie = hasProfile ? "jacob-has-profile=1" : "";
  const headers = new Headers({ host: "app.jacob.app", cookie });
  return new NextRequest(new Request(url, { headers }));
}

describe("middleware onboarding gate", () => {
  const gatedPaths = [
    "/groups/abc",
    "/chat/abc",
    "/boards",
    "/boards/general",
    "/discover",
    "/devotionals",
    "/sermons",
    "/search",
    "/orgs/acme",
    "/admin",
    "/appeals",
    "/reading-plans",
    "/home",
    "/settings",
    "/settings/notifications",
  ];

  for (const path of gatedPaths) {
    it(`gates ${path} when the profile cookie is missing`, async () => {
      const res = await middleware(buildRequest(path, false));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(
        "https://app.jacob.app/onboarding",
      );
    });

    it(`allows ${path} when the profile cookie is set`, async () => {
      const res = await middleware(buildRequest(path, true));
      // NextResponse.next() returns 200 with no Location header.
      expect(res.headers.get("location")).toBeNull();
    });
  }

  const publicPaths = [
    "/",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/verify-email",
    "/onboarding",
    "/privacy",
    "/terms",
    "/guidelines",
    "/faq",
    "/about",
    "/join/some-token",
    "/transparency",
    "/transparency/2026-q1",
  ];

  for (const path of publicPaths) {
    it(`leaves ${path} reachable without the profile cookie`, async () => {
      const res = await middleware(buildRequest(path, false));
      expect(res.headers.get("location")).toBeNull();
    });
  }
});
