import { describe, expect, it } from "vitest";

import { safeNext } from "@/lib/safe-redirect";

describe("safeNext", () => {
  it("returns same-origin paths", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/join?code=ABCD1234")).toBe("/join?code=ABCD1234");
    expect(safeNext("/home")).toBe("/home");
  });

  it("rejects absolute URLs (open-redirect guard)", () => {
    expect(safeNext("https://evil.example/steal")).toBeNull();
    expect(safeNext("http://evil.example")).toBeNull();
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeNext("//evil.example/x")).toBeNull();
  });

  it("rejects backslash-prefixed paths", () => {
    // Some browsers normalize /\foo into //foo, which browsers route by host.
    expect(safeNext("/\\evil.example")).toBeNull();
  });

  it("rejects relative (non-rooted) paths", () => {
    expect(safeNext("join?code=X")).toBeNull();
    expect(safeNext("../etc/passwd")).toBeNull();
  });

  it("rejects nullish / empty / non-string", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext("")).toBeNull();
    expect(safeNext(123 as unknown as string)).toBeNull();
  });
});
