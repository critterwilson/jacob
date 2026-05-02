/**
 * Unit tests for the pure helpers in onMessageWrite.ts. The Firestore
 * trigger itself depends on firebase-functions runtime context and is
 * exercised end-to-end via the emulator (M9 follow-up); here we cover
 * the classification logic and the idempotency invariant.
 */

import { describe, expect, it } from "vitest";

import { classifyChange } from "../onMessageWrite";

describe("classifyChange", () => {
  it("returns 'create' when after exists and before does not", () => {
    expect(classifyChange(false, true, null, null)).toBe("create");
  });

  it("returns 'hard-delete' when before exists and after does not", () => {
    expect(classifyChange(true, false, null, null)).toBe("hard-delete");
  });

  it("returns 'soft-delete' when deletedAt flips null → ts", () => {
    expect(classifyChange(true, true, null, new Date())).toBe("soft-delete");
  });

  it("returns 'undelete' when deletedAt flips ts → null", () => {
    expect(classifyChange(true, true, new Date(), null)).toBe("undelete");
  });

  it("returns 'noop' for an edit that doesn't touch deletedAt", () => {
    expect(classifyChange(true, true, null, null)).toBe("noop");
  });

  it("returns 'noop' for a write where neither version exists", () => {
    expect(classifyChange(false, false, null, null)).toBe("noop");
  });
});
