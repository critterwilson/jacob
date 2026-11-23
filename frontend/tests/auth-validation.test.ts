import { describe, expect, it } from "vitest";
import {
  signInSchema,
  signUpSchema,
  forgotPasswordSchema,
  mapFirebaseAuthError,
} from "@/lib/validation/auth";

describe("signUpSchema", () => {
  it("requires a valid email", () => {
    const r = signUpSchema.safeParse({
      email: "not-an-email",
      password: "Aa1!aaaaaa",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "email")).toBe(true);
    }
  });

  it("rejects passwords shorter than 10 chars", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.co",
      password: "Aa1!a",
    });
    expect(r.success).toBe(false);
  });

  it("rejects passwords without a number", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.co",
      password: "Abcdefghij!",
    });
    expect(r.success).toBe(false);
  });

  it("rejects passwords without a symbol", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.co",
      password: "Abcdefghij1",
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid credentials", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.co",
      password: "Abcdefghij1!",
    });
    expect(r.success).toBe(true);
  });
});

describe("signInSchema", () => {
  it("accepts any non-empty password (we trust the server)", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.co", password: "x" }).success,
    ).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.co", password: "" }).success,
    ).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("requires a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "" }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(
      true,
    );
  });
});

describe("mapFirebaseAuthError", () => {
  it("maps known codes to friendly messages", () => {
    expect(mapFirebaseAuthError("auth/email-already-in-use")).toMatch(
      /already registered/i,
    );
    expect(mapFirebaseAuthError("auth/wrong-password")).toMatch(/incorrect/i);
    expect(mapFirebaseAuthError("auth/network-request-failed")).toMatch(
      /network/i,
    );
    expect(mapFirebaseAuthError("auth/email-not-verified")).toMatch(
      /verify your email/i,
    );
  });

  it("returns a generic message for unknown codes", () => {
    expect(mapFirebaseAuthError("auth/some-future-code")).toMatch(
      /something went wrong/i,
    );
    expect(mapFirebaseAuthError(undefined)).toMatch(/something went wrong/i);
  });
});
