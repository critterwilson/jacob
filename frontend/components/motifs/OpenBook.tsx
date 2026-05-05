import { type SVGProps } from "react";

/**
 * Symbolic motif used as the hero on devotional + sermon surfaces.
 *
 * An open book in line form, with faint text-line marks suggesting set
 * type and a ribbon bookmark hanging from the right page. Drawn with
 * currentColor so callers tone it via the wrapping element (gold-soft).
 *
 * Decorative-only — always rendered with aria-hidden. See
 * docs/design-system.md § 8.
 */
export function OpenBook(props: SVGProps<SVGSVGElement>) {
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
      {/* Left page outline */}
      <path d="M30 38 Q 30 32, 36 32 L 116 38 L 116 132 L 36 126 Q 30 126, 30 120 Z" />
      {/* Right page outline */}
      <path d="M124 38 L 204 32 Q 210 32, 210 38 L 210 120 Q 210 126, 204 126 L 124 132 Z" />
      {/* Faint text-line marks, left page */}
      <g strokeWidth={0.7} opacity={0.5}>
        <line x1={42} y1={52} x2={108} y2={52} />
        <line x1={42} y1={62} x2={104} y2={62} />
        <line x1={42} y1={72} x2={108} y2={72} />
        <line x1={42} y1={82} x2={94} y2={82} />
        <line x1={42} y1={92} x2={104} y2={92} />
      </g>
      {/* Faint text-line marks, right page */}
      <g strokeWidth={0.7} opacity={0.5}>
        <line x1={132} y1={52} x2={200} y2={52} />
        <line x1={132} y1={62} x2={196} y2={62} />
        <line x1={132} y1={72} x2={200} y2={72} />
        <line x1={132} y1={82} x2={190} y2={82} />
        <line x1={132} y1={92} x2={196} y2={92} />
      </g>
      {/* Ribbon bookmark hanging off the top of the right page */}
      <path
        d="M178 30 L 178 78 L 186 72 L 194 78 L 194 30"
        strokeWidth={1.2}
      />
    </svg>
  );
}
