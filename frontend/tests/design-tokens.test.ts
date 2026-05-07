/**
 * Design-token regression test.
 *
 * Locks the resolved Tailwind theme keys that the design system spec
 * (docs/design-system.md) commits to. If any of these tokens drift
 * unintentionally — colors, font families, type scale, spacing,
 * radius, shadow, motion — this snapshot fails and forces a deliberate
 * update of both the config and (in PR review) the spec.
 *
 * If a token change is intentional, run `pnpm test -u` and update
 * docs/design-system.md in the same PR.
 */

import resolveConfig from "tailwindcss/resolveConfig";
import { describe, expect, it } from "vitest";

import tailwindConfig from "../tailwind.config";

const resolved = resolveConfig(tailwindConfig);
const theme = resolved.theme as Record<string, unknown>;

function pickKeys<T extends Record<string, unknown>>(
  obj: T,
  keys: readonly (keyof T)[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    out[k] = obj[k];
  }
  return out;
}

describe("design tokens — resolved Tailwind theme", () => {
  it("colors include the JACOB palette (ink, cream, gold, semantic)", () => {
    const colors = theme.colors as Record<string, unknown>;
    expect(
      pickKeys(colors, [
        "ink",
        "ink-raised",
        "ink-overlay",
        "line",
        "line-strong",
        "cream",
        "cream-muted",
        "gold",
        "gold-soft",
        "gold-deep",
        "terracotta",
        "sage",
        "parchment-amber",
        "lake",
      ]),
    ).toMatchSnapshot();
  });

  it("fontFamily exposes display (serif) and sans tokens", () => {
    expect(theme.fontFamily).toMatchSnapshot();
  });

  it("fontSize includes the display + body + UI type scale", () => {
    const fontSize = theme.fontSize as Record<string, unknown>;
    expect(
      pickKeys(fontSize, [
        "display-xl",
        "display-lg",
        "display-md",
        "display-sm",
        "body-lg",
        "body",
        "body-sm",
        "caption",
        "label",
        "eyebrow",
      ]),
    ).toMatchSnapshot();
  });

  it("spacing includes the custom space-18 (4.5rem section breathing room)", () => {
    const spacing = theme.spacing as Record<string, unknown>;
    expect(spacing["18"]).toBe("4.5rem");
  });

  it("borderRadius matches the spec (sm 4 / md 6 / lg 10 / xl 16 / 2xl 24)", () => {
    const radius = theme.borderRadius as Record<string, unknown>;
    expect(
      pickKeys(radius, ["sm", "DEFAULT", "md", "lg", "xl", "2xl"]),
    ).toMatchSnapshot();
  });

  it("boxShadow includes raise / pop / glow-gold", () => {
    const shadow = theme.boxShadow as Record<string, unknown>;
    expect(
      pickKeys(shadow, ["raise", "pop", "glow-gold"]),
    ).toMatchSnapshot();
  });

  it("transitionDuration includes fast / base / slow", () => {
    const duration = theme.transitionDuration as Record<string, unknown>;
    expect(
      pickKeys(duration, ["fast", "base", "slow"]),
    ).toMatchSnapshot();
  });
});
