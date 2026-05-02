/**
 * Unit tests for the pure helpers in services/textModeration.ts.
 * The Firestore trigger in onMessageCreate.ts is exercised end-to-end
 * via the emulator (separate operational test); here we cover policy
 * thresholds, decision logic, and the circuit breaker.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCircuitForTests,
  decisionFor,
  isCircuitOpen,
  moderateText,
  recordFailure,
  recordSuccess,
  thresholdsFor,
  type Policy,
} from "../services/textModeration";

describe("thresholdsFor", () => {
  it("strict has the lowest hide threshold", () => {
    expect(thresholdsFor("strict").hide).toBeLessThan(thresholdsFor("standard").hide);
    expect(thresholdsFor("standard").hide).toBeLessThan(thresholdsFor("lenient").hide);
  });

  it("flag thresholds sit below hide thresholds", () => {
    for (const policy of ["lenient", "standard", "strict"] as const) {
      const t = thresholdsFor(policy);
      expect(t.flag).toBeLessThan(t.hide);
    }
  });
});

describe("decisionFor", () => {
  it("returns null when nothing exceeds thresholds", () => {
    const result = decisionFor([{ name: "Toxic", confidence: 0.1 }], "standard");
    expect(result.decision).toBeNull();
    expect(result.reasons).toEqual([]);
  });

  it("hides on standard policy when Toxic > 0.85", () => {
    const result = decisionFor([{ name: "Toxic", confidence: 0.9 }], "standard");
    expect(result.decision).toBe("hide");
    expect(result.reasons).toContain("Toxic");
  });

  it("does not hide the same message under lenient policy", () => {
    const result = decisionFor([{ name: "Toxic", confidence: 0.9 }], "lenient");
    expect(result.decision).toBe("flag");
  });

  it("hides under strict at a much lower threshold", () => {
    const result = decisionFor([{ name: "Insult", confidence: 0.72 }], "strict");
    expect(result.decision).toBe("hide");
  });

  it("ignores categories not in the tracked set", () => {
    const result = decisionFor([{ name: "Politics", confidence: 0.99 }], "standard");
    expect(result.decision).toBeNull();
  });

  it("Sexual category is hidden under lenient at the strict threshold", () => {
    // Sexual is in ALWAYS_HIDE_AT_STRICT — at confidence 0.71 under
    // lenient policy (hide=0.95), the always-hide rule still kicks in
    // because 0.71 > strict.hide (0.7).
    const result = decisionFor([{ name: "Sexual", confidence: 0.72 }], "lenient");
    expect(result.decision).toBe("hide");
  });

  it("returns the strongest decision when both hide and flag are triggered", () => {
    const result = decisionFor(
      [
        { name: "Toxic", confidence: 0.9 },
        { name: "Profanity", confidence: 0.75 },
      ],
      "standard",
    );
    expect(result.decision).toBe("hide");
    expect(result.reasons).toEqual(["Toxic"]);
  });
});

describe("circuit breaker", () => {
  beforeEach(() => {
    _resetCircuitForTests();
  });

  afterEach(() => {
    _resetCircuitForTests();
  });

  it("starts closed", () => {
    expect(isCircuitOpen()).toBe(false);
  });

  it("opens after 5 consecutive failures", () => {
    for (let i = 0; i < 5; i += 1) recordFailure();
    expect(isCircuitOpen()).toBe(true);
  });

  it("does not open at 4 failures", () => {
    for (let i = 0; i < 4; i += 1) recordFailure();
    expect(isCircuitOpen()).toBe(false);
  });

  it("a success resets the failure counter", () => {
    recordFailure();
    recordFailure();
    recordSuccess();
    for (let i = 0; i < 4; i += 1) recordFailure();
    expect(isCircuitOpen()).toBe(false);
  });

  it("auto-closes after the open window elapses", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) recordFailure(t0);
    expect(isCircuitOpen(t0)).toBe(true);
    expect(isCircuitOpen(t0 + 6 * 60 * 1000)).toBe(false);
  });
});

describe("moderateText", () => {
  it("calls the client and returns category scores", async () => {
    const fakeClient = {
      moderateText: vi.fn().mockResolvedValue([
        {
          moderationCategories: [
            { name: "Toxic", confidence: 0.42 },
            { name: "Politics", confidence: 0.9 }, // dropped by trigger filter, kept here
            { name: undefined, confidence: 0.5 }, // bad row, dropped
          ],
        },
      ]),
    };

    const result = await moderateText(fakeClient as never, "hello world");
    expect(fakeClient.moderateText).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { name: "Toxic", confidence: 0.42 },
      { name: "Politics", confidence: 0.9 },
    ]);
  });

  it("returns an empty array when the API responds empty", async () => {
    const fakeClient = {
      moderateText: vi.fn().mockResolvedValue([{ moderationCategories: [] }]),
    };
    expect(await moderateText(fakeClient as never, "hi")).toEqual([]);
  });

  it("propagates API errors so the caller can record a failure", async () => {
    const fakeClient = {
      moderateText: vi.fn().mockRejectedValue(new Error("API blew up")),
    };
    await expect(moderateText(fakeClient as never, "hi")).rejects.toThrow("API blew up");
  });
});

// Sanity: Policy type union is exhaustive.
describe("Policy union", () => {
  it("covers exactly lenient, standard, strict", () => {
    const policies: Policy[] = ["lenient", "standard", "strict"];
    for (const p of policies) {
      expect(thresholdsFor(p)).toBeDefined();
    }
  });
});
