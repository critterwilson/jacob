/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: null },
}));

import { ApiError, apiGet, apiPost } from "@/lib/api";

const realFetch = global.fetch;

beforeEach(() => {
  // jsdom defaults window.location.href to http://localhost:3000.
  // Tests that need cross-origin assertions reference that origin explicitly.
});

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("apiGet — happy path", () => {
  it("parses a JSON response and returns it", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ hello: "world" }));
    const result = await apiGet<{ hello: string }>("/api/ping");
    expect(result).toEqual({ hello: "world" });
  });
});

describe("apiPost / apiGet — transport error disambiguation", () => {
  it("surfaces a same-origin TypeError as network_error (and retries by default for GET=0)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiPost("/api/foo", { a: 1 })).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
  });

  it("surfaces a cross-origin TypeError as cors_blocked", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    // The default jsdom origin is http://localhost:3000, so this URL is
    // cross-origin and should trigger the CORS heuristic.
    await expect(
      apiPost("https://api.example.com/v1/widgets", { a: 1 }),
    ).rejects.toMatchObject({
      status: 0,
      code: "cors_blocked",
    });
  });

  it("does NOT retry on cors_blocked even when the verb would normally retry", async () => {
    const mock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    global.fetch = mock;
    await expect(
      apiGet("https://api.example.com/v1/widgets"),
    ).rejects.toMatchObject({ code: "cors_blocked" });
    // GET would normally retry up to 2 times — confirm we short-circuited.
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-TypeError transport failure as network_error even when cross-origin", async () => {
    // A non-TypeError exception is not a CORS preflight failure — it's
    // some other transport problem we shouldn't mislabel.
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNRESET-like failure"));
    await expect(
      apiPost("https://api.example.com/v1/widgets", { a: 1 }),
    ).rejects.toMatchObject({ code: "network_error" });
  });

  it("propagates AbortError as the aborted code regardless of origin", async () => {
    const abortErr = new DOMException("aborted", "AbortError");
    global.fetch = vi.fn().mockRejectedValue(abortErr);
    await expect(
      apiPost("https://api.example.com/v1/widgets", { a: 1 }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("ApiError shape", () => {
  it("carries status, code, message, and details", () => {
    const e = new ApiError(503, "stickers_unavailable", "down", { foo: 1 });
    expect(e.status).toBe(503);
    expect(e.code).toBe("stickers_unavailable");
    expect(e.message).toBe("down");
    expect(e.details).toEqual({ foo: 1 });
    expect(e instanceof Error).toBe(true);
  });
});
