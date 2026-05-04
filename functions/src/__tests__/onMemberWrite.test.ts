/**
 * Unit tests for the leaderDelta pure helper.
 *
 * The cases mirror the truth table in onMemberWrite — they catch off-
 * by-one regressions that would silently break the leaderless-guard
 * rule (the rule reads `leaderCount` and trusts the trigger).
 */

import { describe, expect, it } from "vitest";

import { leaderDelta, orgMirrorAction } from "../onMemberWrite";

describe("leaderDelta", () => {
  it("create as leader → +1", () => {
    expect(leaderDelta(false, true, undefined, "leader")).toBe(1);
  });

  it("create as member → 0", () => {
    expect(leaderDelta(false, true, undefined, "member")).toBe(0);
  });

  it("delete a leader → -1", () => {
    expect(leaderDelta(true, false, "leader", undefined)).toBe(-1);
  });

  it("delete a member → 0", () => {
    expect(leaderDelta(true, false, "member", undefined)).toBe(0);
  });

  it("promote member → leader → +1", () => {
    expect(leaderDelta(true, true, "member", "leader")).toBe(1);
  });

  it("demote leader → member → -1", () => {
    expect(leaderDelta(true, true, "leader", "member")).toBe(-1);
  });

  it("no role change (leader → leader) → 0", () => {
    expect(leaderDelta(true, true, "leader", "leader")).toBe(0);
  });

  it("no role change (member → member) → 0", () => {
    expect(leaderDelta(true, true, "member", "member")).toBe(0);
  });

  it("write with both sides missing → 0", () => {
    expect(leaderDelta(false, false, undefined, undefined)).toBe(0);
  });
});

describe("orgMirrorAction (T54)", () => {
  it("create → join", () => {
    expect(orgMirrorAction(false, true)).toBe("join");
  });

  it("delete → leave", () => {
    expect(orgMirrorAction(true, false)).toBe("leave");
  });

  it("update (e.g. promotion) → noop", () => {
    expect(orgMirrorAction(true, true)).toBe("noop");
  });

  it("phantom write (both missing) → noop", () => {
    expect(orgMirrorAction(false, false)).toBe("noop");
  });
});
