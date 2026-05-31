/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { getCopy } from "@/lib/copy";

describe("getCopy (T56)", () => {
  it("returns the christian variant by default", () => {
    expect(getCopy("christian", "discover.title")).toBe("Find a small group");
  });

  it("resolves the bjj audience to christian copy (BJJ flavor scrapped)", () => {
    expect(getCopy("bjj", "discover.title")).toBe("Find a small group");
  });

  it("resolves any audience to a defined christian key", () => {
    expect(getCopy("bjj", "discover.audienceFilter.label")).toBe("Group type");
  });

  it("returns the raw key when neither variant defines it", () => {
    expect(getCopy("bjj", "totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("treats general audience as christian", () => {
    expect(getCopy("general", "discover.title")).toBe("Find a small group");
  });
});
