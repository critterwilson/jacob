import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
}));

import * as SentryMock from "@sentry/nextjs";
import { initSentry } from "../lib/sentry";

const mockInit = SentryMock.init as ReturnType<typeof vi.fn>;

describe("initSentry", () => {
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
  });

  it("does nothing when NEXT_PUBLIC_SENTRY_DSN is unset", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    initSentry();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("calls Sentry.init when DSN is set", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://abc@sentry.io/1";
    initSentry();
    expect(mockInit).toHaveBeenCalledOnce();
  });

  it("initialises with sendDefaultPii=false", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://abc@sentry.io/1";
    initSentry();
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ sendDefaultPii: false })
    );
  });

  it("passes the correct DSN", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://abc@sentry.io/1";
    initSentry();
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "https://abc@sentry.io/1" })
    );
  });

  describe("beforeSend PII scrubbing", () => {
    function getBeforeSend() {
      process.env.NEXT_PUBLIC_SENTRY_DSN = "https://abc@sentry.io/1";
      initSentry();
      return mockInit.mock.calls[0][0].beforeSend as (
        event: Record<string, unknown>
      ) => Record<string, unknown> | null;
    }

    it("scrubs email addresses from exception values", () => {
      const beforeSend = getBeforeSend();
      const event = {
        exception: {
          values: [{ value: "Failed for user@example.com" }],
        },
      };
      const result = beforeSend(event) as {
        exception: { values: Array<{ value: string }> };
      };
      expect(result?.exception?.values[0].value).toBe("Failed for [email]");
    });

    it("strips request body", () => {
      const beforeSend = getBeforeSend();
      const event = {
        request: { data: '{"body":"private text"}', url: "/api" },
      };
      const result = beforeSend(event) as Record<string, Record<string, unknown>>;
      expect(result?.request?.data).toBeUndefined();
      expect(result?.request?.url).toBe("/api");
    });

    it("strips Authorization header", () => {
      const beforeSend = getBeforeSend();
      const event = {
        request: {
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json",
          },
        },
      };
      const result = beforeSend(event) as Record<string, Record<string, Record<string, string>>>;
      expect(result?.request?.headers?.authorization).toBeUndefined();
      expect(result?.request?.headers?.["content-type"]).toBe("application/json");
    });

    it("returns event unchanged when no PII present", () => {
      const beforeSend = getBeforeSend();
      const event = {
        exception: { values: [{ value: "Connection refused" }] },
      };
      const result = beforeSend(event) as {
        exception: { values: Array<{ value: string }> };
      };
      expect(result?.exception?.values[0].value).toBe("Connection refused");
    });
  });
});
