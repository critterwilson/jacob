import { type SVGProps } from "react";

/**
 * A small line-art olive sprig — a stem with paired leaves and a couple
 * of olives. Part of the Olive Branch motif system; used for empty
 * states ("this branch is quiet for now…") and as a section accent.
 *
 * Drawn with currentColor so callers tone it via the wrapping element
 * (e.g. `text-sage` or `text-gold-soft`). Decorative-only — always
 * rendered with aria-hidden. See docs/design-system.md § 8.
 */
export function OliveSprig(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 96 64"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.4}
      aria-hidden="true"
      {...props}
    >
      {/* Main stem, gently rising left → right */}
      <path d="M10 50 Q 44 40, 86 16" />

      {/* Paired leaves along the stem (soft fill so they read as foliage) */}
      <path
        d="M30 44 Q 33 35, 42 34 Q 36 42, 30 44 Z"
        fill="currentColor"
        fillOpacity={0.16}
      />
      <path
        d="M34 47 Q 31 56, 22 57 Q 28 49, 34 47 Z"
        fill="currentColor"
        fillOpacity={0.16}
      />
      <path
        d="M52 35 Q 55 26, 64 25 Q 58 33, 52 35 Z"
        fill="currentColor"
        fillOpacity={0.16}
      />
      <path
        d="M70 26 Q 73 17, 82 16 Q 76 24, 70 26 Z"
        fill="currentColor"
        fillOpacity={0.16}
      />

      {/* Two olives */}
      <circle cx={44} cy={42} r={2.4} fill="currentColor" fillOpacity={0.5} />
      <circle cx={62} cy={32} r={2.4} fill="currentColor" fillOpacity={0.5} />
    </svg>
  );
}
