import { describe, expect, it } from "vitest";

import { safeHttpUrl, safeImageSrc } from "@/lib/safeUrl";

describe("safeHttpUrl", () => {
  it("accepts https", () => {
    expect(safeHttpUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  it("accepts http", () => {
    expect(safeHttpUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("rejects javascript:", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects data:", () => {
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects blob:", () => {
    expect(safeHttpUrl("blob:https://example.com/abc")).toBeNull();
  });

  it("rejects mailto:", () => {
    expect(safeHttpUrl("mailto:foo@example.com")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(safeHttpUrl("not a url")).toBeNull();
  });

  it("treats null/undefined/empty as null", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
  });
});

describe("safeImageSrc", () => {
  it("accepts http/https", () => {
    expect(safeImageSrc("https://example.com/p.jpg")).toBe(
      "https://example.com/p.jpg",
    );
    expect(safeImageSrc("http://example.com/p.jpg")).toBe(
      "http://example.com/p.jpg",
    );
  });

  it("accepts blob: previews", () => {
    expect(safeImageSrc("blob:https://example.com/abc")).toBe(
      "blob:https://example.com/abc",
    );
  });

  it("accepts data:image/png|jpeg|gif|webp", () => {
    expect(safeImageSrc("data:image/png;base64,xyz")).toBe(
      "data:image/png;base64,xyz",
    );
    expect(safeImageSrc("data:image/jpeg;base64,xyz")).toBe(
      "data:image/jpeg;base64,xyz",
    );
    expect(safeImageSrc("data:image/gif;base64,xyz")).toBe(
      "data:image/gif;base64,xyz",
    );
    expect(safeImageSrc("data:image/webp;base64,xyz")).toBe(
      "data:image/webp;base64,xyz",
    );
  });

  it("rejects data:image/svg+xml (L-FRONT-1: SVG can carry script)", () => {
    expect(
      safeImageSrc('data:image/svg+xml,<svg onload="alert(1)"/>'),
    ).toBeNull();
  });

  it("rejects javascript:", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBeNull();
  });

  it("rejects data:text/html", () => {
    expect(
      safeImageSrc("data:text/html,<script>alert(1)</script>"),
    ).toBeNull();
  });

  it("treats null/undefined/empty as null", () => {
    expect(safeImageSrc(null)).toBeNull();
    expect(safeImageSrc(undefined)).toBeNull();
    expect(safeImageSrc("")).toBeNull();
  });
});
