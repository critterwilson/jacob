import { type SVGProps } from "react";

/**
 * Symbolic motif used as the hero on auth surfaces.
 *
 * A long horizontal cloud-line with rays of light fanning down from a
 * central focal point. Drawn with currentColor so callers tone it via
 * a wrapping element (e.g. `text-gold-soft`).
 *
 * Decorative-only — always rendered with aria-hidden. See
 * docs/design-system.md § 8 for the symbolic-imagery rules.
 */
export function LightFromClouds(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 240 170"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
      {...props}
    >
      {/* Cloud edge: long horizontal arc with two soft rises */}
      <path
        d="M16 64 Q42 46 70 58 Q92 40 120 54 Q146 42 174 58 Q202 64 224 58"
        strokeWidth={1.3}
      />
      {/* Rays of light fanning from a focal point just below the cloud */}
      <g strokeWidth={0.7}>
        <line x1="120" y1="68" x2="56" y2="158" opacity={0.5} />
        <line x1="120" y1="68" x2="78" y2="162" opacity={0.65} />
        <line x1="120" y1="68" x2="100" y2="164" opacity={0.8} />
        <line x1="120" y1="68" x2="120" y2="166" opacity={1} />
        <line x1="120" y1="68" x2="140" y2="164" opacity={0.8} />
        <line x1="120" y1="68" x2="162" y2="162" opacity={0.65} />
        <line x1="120" y1="68" x2="184" y2="158" opacity={0.5} />
      </g>
    </svg>
  );
}
