import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TypesenseClient,
  TypesenseError,
  _resetCircuitForTests,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  type FetchLike,
} from "../services/typesense";

beforeEach(() => {
  _resetCircuitForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── client ────────────────────────────────────────────────────────────────────

describe("TypesenseClient.upsert", () => {
  it("POSTs to /collections/{c}/documents?action=upsert with the API key header", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ id: "m1" }),
    })) as unknown as FetchLike;

    const client = new TypesenseClient({
      host: "https://ts.example.com",
      apiKey: "k",
      collection: "messages",
      fetchImpl,
    });

    await client.upsert({
      id: "m1",
      groupId: "g1",
      authorUid: "u1",
      body: "hi",
      createdAtUnix: 100,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://ts.example.com/collections/messages/documents?action=upsert");
    expect(init.method).toBe("POST");
    expect(init.headers["X-TYPESENSE-API-KEY"]).toBe("k");
    expect(JSON.parse(init.body as string)).toEqual({
      id: "m1",
      groupId: "g1",
      authorUid: "u1",
      body: "hi",
      createdAtUnix: 100,
    });
  });

  it("throws TypesenseError with the response status on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    })) as unknown as FetchLike;

    const client = new TypesenseClient({
      host: "https://ts.example.com",
      apiKey: "k",
      collection: "messages",
      fetchImpl,
    });

    await expect(
      client.upsert({
        id: "m1",
        groupId: "g1",
        authorUid: "u1",
        body: "hi",
        createdAtUnix: 100,
      }),
    ).rejects.toBeInstanceOf(TypesenseError);
  });
});

describe("TypesenseClient.deleteById", () => {
  it("swallows 404 — deleting an absent doc is a no-op", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => "not found",
      json: async () => ({}),
    })) as unknown as FetchLike;

    const client = new TypesenseClient({
      host: "https://ts.example.com",
      apiKey: "k",
      collection: "messages",
      fetchImpl,
    });

    await expect(client.deleteById("m1")).resolves.toBeUndefined();
  });

  it("re-raises non-404 failures", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "down",
      json: async () => ({}),
    })) as unknown as FetchLike;

    const client = new TypesenseClient({
      host: "https://ts.example.com",
      apiKey: "k",
      collection: "messages",
      fetchImpl,
    });

    await expect(client.deleteById("m1")).rejects.toBeInstanceOf(TypesenseError);
  });
});

// ── circuit breaker ──────────────────────────────────────────────────────────

describe("circuit breaker", () => {
  it("opens after 5 consecutive failures", () => {
    expect(isCircuitOpen()).toBe(false);
    for (let i = 0; i < 4; i++) recordFailure();
    expect(isCircuitOpen()).toBe(false);
    recordFailure();
    expect(isCircuitOpen()).toBe(true);
  });

  it("recordSuccess resets the failure count", () => {
    for (let i = 0; i < 4; i++) recordFailure();
    recordSuccess();
    recordFailure();
    expect(isCircuitOpen()).toBe(false);
  });

  it("auto-closes after the open duration", () => {
    for (let i = 0; i < 5; i++) recordFailure(0);
    expect(isCircuitOpen(0)).toBe(true);
    expect(isCircuitOpen(6 * 60 * 1000)).toBe(false);
  });
});
