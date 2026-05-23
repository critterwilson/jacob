import { describe, expect, it } from "vitest";

import { tokenize, tokensEqual } from "../onMessageTokenize";

describe("tokenize", () => {
  it("lowercases, splits on non-word, dedupes preserving order", () => {
    expect(tokenize("Hello, HELLO world!")).toEqual(["hello", "world"]);
  });

  it("returns an empty list for non-string / empty body", () => {
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize(123)).toEqual([]);
    expect(tokenize("    ")).toEqual([]);
    expect(tokenize("...?!")).toEqual([]);
  });

  it("handles numerics", () => {
    expect(tokenize("verse 23:17")).toEqual(["verse", "23", "17"]);
  });

  it("caps at 100 tokens to bound doc size", () => {
    const words = Array.from({ length: 250 }, (_, i) => `w${i}`).join(" ");
    expect(tokenize(words).length).toBe(100);
  });
});

describe("tokensEqual", () => {
  it("returns true for equal arrays", () => {
    expect(tokensEqual(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("returns false when length differs", () => {
    expect(tokensEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("returns false when order differs", () => {
    expect(tokensEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("returns false when the stored field is not an array", () => {
    expect(tokensEqual(["a"], undefined)).toBe(false);
    expect(tokensEqual(["a"], null)).toBe(false);
    expect(tokensEqual(["a"], "a")).toBe(false);
  });
});
