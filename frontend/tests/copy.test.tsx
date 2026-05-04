/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { getCopy } from "@/lib/copy";

describe("getCopy (T56)", () => {
  it("returns the christian variant by default", () => {
    expect(getCopy("christian", "discover.title")).toBe("Find a small group");
  });

  it("returns the bjj variant when audience=bjj", () => {
    expect(getCopy("bjj", "discover.title")).toBe(
      "Find your next training partner",
    );
  });

  it("falls back to christian when bjj doesn't override the key", () => {
    expect(getCopy("bjj", "discover.audienceFilter.label")).toBe("Group type");
  });

  it("returns the raw key when neither variant defines it", () => {
    expect(getCopy("bjj", "totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("treats general audience as christian", () => {
    expect(getCopy("general", "discover.title")).toBe("Find a small group");
  });
});
