/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingDob,
  clearPendingInviteCode,
  readPendingDob,
  readPendingInviteCode,
  stashPendingDob,
  stashPendingInviteCode,
} from "@/lib/pending-application";

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("pending DOB", () => {
  it("round-trips a stashed DOB through sessionStorage", () => {
    stashPendingDob("1990-04-12");
    expect(readPendingDob()).toBe("1990-04-12");
    clearPendingDob();
    expect(readPendingDob()).toBeNull();
  });

  it("returns null when nothing is stashed", () => {
    expect(readPendingDob()).toBeNull();
  });
});

describe("pending invite code", () => {
  it("round-trips a stashed invite code through sessionStorage", () => {
    stashPendingInviteCode("ABCD1234");
    expect(readPendingInviteCode()).toBe("ABCD1234");
    clearPendingInviteCode();
    expect(readPendingInviteCode()).toBeNull();
  });

  it("normalizes case on stash", () => {
    stashPendingInviteCode("abcd1234");
    expect(readPendingInviteCode()).toBe("ABCD1234");
  });

  it("refuses to stash a malformed code (silent no-op)", () => {
    stashPendingInviteCode("has spaces!");
    expect(readPendingInviteCode()).toBeNull();
    stashPendingInviteCode("");
    expect(readPendingInviteCode()).toBeNull();
    stashPendingInviteCode(
      "WAY-WAY-WAY-WAY-WAY-WAY-WAY-WAY-WAY-TOO-LONG-FOR-AN-INVITE",
    );
    expect(readPendingInviteCode()).toBeNull();
  });

  it("returns null if sessionStorage holds a value that's no longer valid", () => {
    // Simulate corruption: someone wrote garbage to the key directly.
    window.sessionStorage.setItem("jacob-pending-invite-code", "bad chars!!");
    expect(readPendingInviteCode()).toBeNull();
  });

  it("DOB and invite code use distinct keys", () => {
    stashPendingDob("1990-04-12");
    stashPendingInviteCode("ABCD1234");
    expect(readPendingDob()).toBe("1990-04-12");
    expect(readPendingInviteCode()).toBe("ABCD1234");
    clearPendingDob();
    expect(readPendingInviteCode()).toBe("ABCD1234");
  });
});
