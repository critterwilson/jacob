// SSE client for the chat stream (M5 / ADR 0013).
//
// We don't use the native `EventSource` because it can't attach an
// `Authorization` header — Firebase ID tokens are bearer-only, so a
// query-string token would have to be a short-lived stream-specific
// secret, adding a whole separate auth surface. Instead we open the
// stream via `fetch()` (which honours headers), drain the response
// body as a `ReadableStream`, and parse the `text/event-stream`
// framing inline.
//
// The parser implements just enough of the spec (HTML Living Standard,
// "Parsing an event stream") for our use:
//   * lines end at \n, \r, or \r\n;
//   * lines beginning with `:` are comments (used as keep-alives);
//   * `event:` sets the event name, `data:` accumulates the payload;
//   * a blank line dispatches the event.
//
// Out of scope: `id:`, `retry:`, multi-line data folding beyond
// concatenation. The backend doesn't emit any of those.

import { auth } from "@/lib/firebase";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type StreamEvent = { event: string; data: string };

export type StreamHandle = {
  /** Close the stream. Idempotent. */
  close: () => void;
};

export type OpenStreamOpts = {
  /** Called once the first byte (the `: connected` comment) arrives. */
  onOpen?: () => void;
  /** Called for every dispatched event. */
  onEvent: (ev: StreamEvent) => void;
  /** Called on any error that terminates the stream. */
  onError?: (err: Error) => void;
};

function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/**
 * Open an SSE connection. Returns a handle the caller uses to close it.
 *
 * Resolves once the request kicks off (not once the stream completes).
 * Errors during open (non-200 status, transport failure) surface to
 * `onError`. The connection holds open until `close()` is called or the
 * server ends the response.
 *
 * The implementation is intentionally minimal — no auto-reconnect, no
 * backoff. The caller (the React hook) owns that policy so it can
 * coordinate with the polling-fallback state machine.
 */
export async function openStream(
  path: string,
  opts: OpenStreamOpts,
): Promise<StreamHandle> {
  const ctl = new AbortController();
  let closed = false;
  const handle: StreamHandle = {
    close: () => {
      if (!closed) {
        closed = true;
        ctl.abort();
      }
    },
  };

  const headers: Record<string, string> = {
    ...(await authHeader()),
    Accept: "text/event-stream",
    // Browsers default to `Cache-Control: no-cache` on fetch but Firefox
    // has been observed to send `If-None-Match` if a prior response
    // carried an ETag. Force a no-cache to prevent a 304 from being
    // misinterpreted as the stream body.
    "Cache-Control": "no-cache",
  };

  const url = resolveUrl(path);

  // Fire-and-don't-await — we want this function to return a handle
  // ASAP so the hook can wire onError to its reconnect logic without
  // blocking on the open.
  void (async () => {
    let response: Response;
    try {
      // SSE needs the raw ReadableStream + custom headers; apiGet/apiPost
      // wrappers buffer the body into JSON and can't expose chunked frames.
      // eslint-disable-next-line no-restricted-syntax
      response = await fetch(url, {
        method: "GET",
        headers,
        signal: ctl.signal,
        credentials: "include",
      });
    } catch (err) {
      if (closed) return;
      const e = err instanceof Error ? err : new Error("stream_fetch_failed");
      if (e.name === "AbortError") return;
      opts.onError?.(e);
      return;
    }
    if (!response.ok) {
      opts.onError?.(
        new Error(`stream_status_${response.status}`),
      );
      return;
    }
    if (!response.body) {
      opts.onError?.(new Error("stream_no_body"));
      return;
    }

    let opened = false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let currentEvent = "message";
    let currentData: string[] = [];

    const flush = () => {
      if (currentData.length === 0 && currentEvent === "message") {
        currentEvent = "message";
        return;
      }
      const data = currentData.join("\n");
      currentData = [];
      const ev = currentEvent;
      currentEvent = "message";
      if (data.length === 0) return; // empty dispatch with no `data:` lines
      opts.onEvent({ event: ev, data });
    };

    const handleLine = (line: string) => {
      if (line === "") {
        // Empty line = dispatch.
        flush();
        return;
      }
      if (line.startsWith(":")) {
        // Comment. The backend uses `: connected` and `: ping`.
        if (!opened) {
          opened = true;
          opts.onOpen?.();
        }
        return;
      }
      // The first chunk over the wire is `: connected\n\n`, but a
      // race could land a `data:` line before the comment was parsed.
      // Fire onOpen on the first non-empty meaningful line too.
      if (!opened) {
        opened = true;
        opts.onOpen?.();
      }
      const colon = line.indexOf(":");
      let field: string;
      let value: string;
      if (colon === -1) {
        field = line;
        value = "";
      } else {
        field = line.slice(0, colon);
        // Per spec: if value starts with a single space, trim it.
        value = line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
      }
      if (field === "event") {
        currentEvent = value;
      } else if (field === "data") {
        currentData.push(value);
      }
      // `id` and `retry` are intentionally ignored.
    };

    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split on any spec-conformant line terminator.
        let lineEnd: number;
        // eslint-disable-next-line no-cond-assign
        while ((lineEnd = buffer.search(/\r\n|\r|\n/)) !== -1) {
          const line = buffer.slice(0, lineEnd);
          const term = buffer[lineEnd] === "\r" && buffer[lineEnd + 1] === "\n" ? 2 : 1;
          buffer = buffer.slice(lineEnd + term);
          handleLine(line);
        }
      }
    } catch (err) {
      if (closed) return;
      const e = err instanceof Error ? err : new Error("stream_read_failed");
      if (e.name !== "AbortError") opts.onError?.(e);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore — reader may already be released
      }
      // A clean end of stream (server-side timeout / shutdown) is still
      // an error from the hook's POV because it should reopen.
      if (!closed) {
        opts.onError?.(new Error("stream_closed_by_server"));
      }
    }
  })();

  return handle;
}
