import type { Config } from "tailwindcss";

/*
 * JACOB design tokens — Tailwind theme.
 *
 * Source of truth: docs/design-system.md
 * CSS variable mirror: frontend/styles/tokens.css
 *
 * The values below intentionally reference CSS custom properties so a
 * future light-mode pass can flip token values via :root selectors
 * without touching this file. Token names match the spec; component
 * code references them via standard Tailwind utilities (bg-ink,
 * text-cream, font-display, text-display-md, rounded-xl, etc.).
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        ink: "var(--color-ink)",
        "ink-raised": "var(--color-ink-raised)",
        "ink-overlay": "var(--color-ink-overlay)",

        // Lines and borders
        line: "var(--color-line)",
        "line-strong": "var(--color-line-strong)",

        // Text
        cream: "var(--color-cream)",
        "cream-muted": "var(--color-cream-muted)",

        // Accent
        gold: "var(--color-gold)",
        "gold-soft": "var(--color-gold-soft)",
        "gold-deep": "var(--color-gold-deep)",

        // Semantic
        terracotta: "var(--color-terracotta)",
        sage: "var(--color-sage)",
        "parchment-amber": "var(--color-parchment-amber)",
        lake: "var(--color-lake)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
      },
      fontSize: {
        // Display (serif). [size, { lineHeight, letterSpacing, fontWeight }]
        "display-xl": ["3.5rem", { lineHeight: "1.05", fontWeight: "600" }],
        "display-lg": ["2.5rem", { lineHeight: "1.10", fontWeight: "600" }],
        "display-md": ["2rem", { lineHeight: "1.15", fontWeight: "600" }],
        "display-sm": ["1.5rem", { lineHeight: "1.25", fontWeight: "600" }],

        // Body (sans)
        "body-lg": ["1.125rem", { lineHeight: "1.60", fontWeight: "400" }],
        body: ["1rem", { lineHeight: "1.55", fontWeight: "400" }],
        "body-sm": ["0.875rem", { lineHeight: "1.50", fontWeight: "400" }],
        caption: ["0.75rem", { lineHeight: "1.40", fontWeight: "500" }],

        // UI (sans)
        label: ["0.8125rem", { lineHeight: "1.30", fontWeight: "500" }],
        eyebrow: [
          "0.6875rem",
          {
            lineHeight: "1.30",
            letterSpacing: "0.08em",
            fontWeight: "600",
          },
        ],
      },
      spacing: {
        // Section breathing room — the one custom spacing value.
        "18": "4.5rem",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },
      boxShadow: {
        raise: "var(--shadow-raise)",
        pop: "var(--shadow-pop)",
        "glow-gold": "var(--shadow-glow-gold)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
    },
  },
  plugins: [],
};

export default config;
