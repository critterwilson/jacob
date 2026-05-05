import { type SVGProps } from "react";

/**
 * Symbolic motif used as the hero on the landing page.
 *
 * A stylized dove in flight — single hero per surface. Drawn in line
 * form with currentColor so callers tone it via the wrapping element
 * (e.g. `text-gold-soft`). Decorative-only — always rendered with
 * aria-hidden. See docs/design-system.md § 8 for the symbolic-imagery
 * rules.
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

      {/* Eye */}
      <circle cx={163} cy={80} r={1} fill="currentColor" stroke="none" />

      {/* Tail feathers */}
      <path d="M30 92 L 12 98 M 30 89 L 10 88 M 30 86 L 14 78" strokeWidth={1} />
    </svg>
  );
}
