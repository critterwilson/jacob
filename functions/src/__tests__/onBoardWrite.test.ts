/**
 * Unit tests for the pure classification helper used by onBoardPostWrite
 * and onBoardReplyWrite.
 */
import { describe, expect, it } from "vitest";

import { classifyPostChange } from "../onBoardPostWrite";

describe("classifyPostChange", () => {
  it("create: !before && after", () => {
    expect(classifyPostChange(false, true, null, null)).toBe("create");
  });

  it("soft-delete: deletedAt null → ts", () => {
    expect(classifyPostChange(true, true, null, new Date())).toBe(
      "soft-delete",
    );
  });

  it("undelete: deletedAt ts → null", () => {
    expect(classifyPostChange(true, true, new Date(), null)).toBe("undelete");
  });

  it("noop on edit untouched by deletedAt", () => {
    expect(classifyPostChange(true, true, null, null)).toBe("noop");
  });

  it("noop when neither version exists", () => {
    expect(classifyPostChange(false, false, null, null)).toBe("noop");
  });
});
