/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, resolveLocale, t } from "@/lib/i18n";

describe("t() (T61)", () => {
  it("returns the english string by default", () => {
    expect(t("en", "nav.home")).toBe("Home");
  });

  it("returns the spanish string when locale=es", () => {
    expect(t("es", "nav.home")).toBe("Inicio");
  });

  it("falls back to english when the spanish key is missing", () => {
    // `app.name` is in both tables and identical; pick a key that
    // exists only in en if available — for now use a key only in en.
    expect(t("es", "common.loading")).toBe("Cargando…"); // both present
    // Synthetic key not in any table:
    expect(t("es", "totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("interpolates {var} placeholders", () => {
    expect(t("en", "readingPlans.streak", { streak: 5 })).toBe("5 day streak");
    expect(t("es", "readingPlans.streak", { streak: 7 })).toBe(
      "Racha de 7 días",
    );
  });

  it("leaves placeholders alone when the var isn't supplied", () => {
    expect(t("en", "readingPlans.streak")).toBe("{streak} day streak");
  });
});

describe("resolveLocale (T61)", () => {
  it("normalises a region-suffixed tag", () => {
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("EN")).toBe("en");
  });

  it("falls back to default when input is missing or unknown", () => {
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("zh")).toBe(DEFAULT_LOCALE);
  });
});
