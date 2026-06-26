import { type SVGProps } from "react";

/**
 * A thin olive-branch rule: a horizontal line with a small sprig at its
 * center. Part of the Olive Branch motif system — a warmer replacement
 * for a plain `<hr>` / `divide-*` between sections.
 *
 * Drawn with currentColor (tone via the wrapper, e.g. `text-line-strong`
 * or `text-sage`). Decorative-only — aria-hidden. The SVG scales to the
 * width of its container via `w-full`; give it a height utility.
 */
export function OliveDivider(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 240 16"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.2}
      preserveAspectRatio="none"
      aria-hidden="true"
      {...props}
    >
      {/* Rules left and right of the centered sprig */}
      <path d="M0 8 H 98" preserveAspectRatio="none" />
      <path d="M142 8 H 240" />

      {/* Centered sprig: a short stem with two paired leaves */}
      <path d="M104 8 Q 116 8, 128 5" />
      <path
        d="M114 7 Q 117 2, 124 2 Q 119 6, 114 7 Z"
        fill="currentColor"
        fillOpacity={0.2}
      />
      <path
        d="M116 9 Q 113 14, 106 14 Q 111 10, 116 9 Z"
        fill="currentColor"
        fillOpacity={0.2}
      />
      <circle cx={120} cy={8} r={1.6} fill="currentColor" fillOpacity={0.55} />
    </svg>
  );
}
