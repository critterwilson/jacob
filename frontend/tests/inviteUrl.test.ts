/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getInviteUrl } from "@/lib/inviteUrl";

// Read the actual origin jsdom sets up (varies by vitest config; typically
// "http://localhost:3000"). Using window.location.origin directly ensures
// the test stays in sync with whatever vitest puts in the test environment.
const JSDOM_ORIGIN = window.location.origin;

describe("getInviteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses window.location.origin when NEXT_PUBLIC_APP_URL is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const url = getInviteUrl("ABCD1234");
    expect(url).toBe(`${JSDOM_ORIGIN}/join?code=ABCD1234`);
  });

  it("uses window.location.origin when NEXT_PUBLIC_APP_URL is undefined", () => {
    // process.env key missing entirely
    delete process.env.NEXT_PUBLIC_APP_URL;
    const url = getInviteUrl("ABCD1234");
    expect(url).toBe(`${JSDOM_ORIGIN}/join?code=ABCD1234`);
  });

  it("prefers NEXT_PUBLIC_APP_URL over window.location.origin when set", () => {
    const staging =
      "https://jacob-frontend--jacob-staging-494515.us-central1.hosted.app";
    vi.stubEnv("NEXT_PUBLIC_APP_URL", staging);
    const url = getInviteUrl("ABCD1234");
    expect(url).toBe(`${staging}/join?code=ABCD1234`);
  });

  it("encodes the code verbatim in the query string", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getInviteUrl("XY9Z1234")).toMatch(/\/join\?code=XY9Z1234$/);
  });

  it("never produces a jacob.app or jacob.com placeholder URL", () => {
    // Neither env-var path nor window.location.origin path should ever
    // yield the old backend default domain.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getInviteUrl("ABCD1234")).not.toMatch(/jacob\.(app|com)/);
  });

  it("with staging env var set, URL does not contain the backend placeholder", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_APP_URL",
      "https://jacob-frontend--jacob-staging-494515.us-central1.hosted.app",
    );
    expect(getInviteUrl("ABCD1234")).not.toMatch(/jacob\.(app|com)/);
  });
});
