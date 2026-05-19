/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

import { openStream } from "@/lib/sse";

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

/**
 * Build a `Response` whose body is a ReadableStream feeding the given
 * sequence of chunks. Used to simulate an SSE response.
 */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("openStream — SSE parsing", () => {
  it("fires onOpen when the first comment lands", async () => {
    global.fetch = vi.fn().mockResolvedValue(sseResponse([": connected\n\n"]));
    const onOpen = vi.fn();
    const onEvent = vi.fn();
    await openStream("/api/stream", { onOpen, onEvent });
    // The reader is consumed asynchronously; yield to it.
    await new Promise((r) => setTimeout(r, 10));
    expect(onOpen).toHaveBeenCalled();
  });

  it("dispatches a message event with the data payload", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          ": connected\n\n",
          "event: message\ndata: {\"id\":\"m1\",\"body\":\"hi\"}\n\n",
        ]),
      );
    const events: { event: string; data: string }[] = [];
    await openStream("/api/stream", {
      onEvent: (ev) => events.push(ev),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("message");
    expect(JSON.parse(events[0]!.data)).toEqual({ id: "m1", body: "hi" });
  });

  it("ignores `: ping` keep-alives", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          ": connected\n\n",
          ": ping\n\n",
          "event: message\ndata: {\"id\":\"m1\"}\n\n",
          ": ping\n\n",
        ]),
      );
    const events: { event: string; data: string }[] = [];
    await openStream("/api/stream", {
      onEvent: (ev) => events.push(ev),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("message");
  });

  it("calls onError on non-200 status", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("nope", { status: 503 }),
      );
    const onError = vi.fn();
    await openStream("/api/stream", { onEvent: vi.fn(), onError });
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalled();
    const err = onError.mock.calls[0]?.[0] as Error;
    expect(err.message).toBe("stream_status_503");
  });

  it("calls onError when the stream ends cleanly (server closed)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(sseResponse([": connected\n\n"]));
    const onError = vi.fn();
    await openStream("/api/stream", { onEvent: vi.fn(), onError });
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalled();
    const err = onError.mock.calls[0]?.[0] as Error;
    expect(err.message).toBe("stream_closed_by_server");
  });

  it("close() aborts the stream and silences onError", async () => {
    // A response that never ends — simulates a long-lived stream.
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        // Don't close; the abort signal terminates it.
      },
    });
    global.fetch = vi.fn((_url, init: RequestInit | undefined) => {
      const signal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
        signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const onError = vi.fn();
    const handle = await openStream("/api/stream", {
      onEvent: vi.fn(),
      onError,
    });
    await new Promise((r) => setTimeout(r, 10));
    handle.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles \\r\\n line terminators", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          ": connected\r\n\r\n",
          "event: message\r\ndata: hi\r\n\r\n",
        ]),
      );
    const events: { event: string; data: string }[] = [];
    await openStream("/api/stream", {
      onEvent: (ev) => events.push(ev),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual([{ event: "message", data: "hi" }]);
  });
});
