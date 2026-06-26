import { type SVGProps } from "react";

/**
 * The primary Olive Branch brand mark: a dove bearing an olive sprig
 * (Genesis 8:11 — "the storm is over, you're home"). Used as the hero
 * on the landing page and as the corner mark.
 *
 * A stylized dove in flight carrying a three-leaf olive sprig in its
 * beak. Drawn in line form with currentColor so callers tone it via the
 * wrapping element (e.g. `text-gold-soft` or `text-sage`). Decorative-
 * only — always rendered with aria-hidden. See docs/design-system.md
 * § 8 for the symbolic-imagery rules.
 */
export function Dove(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 240 160"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.4}
      aria-hidden="true"
      {...props}
    >
      {/* Upper wing: a long arc raised over the body */}
      <path d="M28 88 C 62 38, 112 32, 148 70" />

      {/* Lower body curve continuing into the tail */}
      <path d="M28 88 Q 50 112, 98 112 Q 132 110, 148 92" />

      {/* Inner wing detail — a soft fold visible across the wing */}
      <path d="M58 82 Q 96 78, 132 84" strokeWidth={0.9} opacity={0.6} />

      {/* Head */}
      <circle cx={162} cy={82} r={9} />

      {/* Beak */}
      <path d="M171 80 L 180 78 L 171 83" />

      {/* Olive sprig held in the beak — a short stem with three leaves.
          Leaves are softly filled so they still read as foliage at small
          sizes; the stem keeps the single line weight. */}
      <path d="M180 78 Q 190 74, 202 67" strokeWidth={1.1} />
      <path
        d="M189 75 Q 193 69, 200 69 Q 195 74, 189 75 Z"
        fill="currentColor"
        fillOpacity={0.18}
      />
      <path
        d="M194 72 Q 197 65, 205 64 Q 200 71, 194 72 Z"
        fill="currentColor"
        fillOpacity={0.18}
      />
      <path
        d="M200 68 Q 202 61, 209 59 Q 205 66, 200 68 Z"
        fill="currentColor"
        fillOpacity={0.18}
      />

      {/* Eye */}
      <circle cx={163} cy={80} r={1} fill="currentColor" stroke="none" />

      {/* Tail feathers */}
      <path d="M30 92 L 12 98 M 30 89 L 10 88 M 30 86 L 14 78" strokeWidth={1} />
    </svg>
  );
}
