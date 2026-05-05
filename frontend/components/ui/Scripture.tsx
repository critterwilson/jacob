import { type ReactNode } from "react";

import { cn } from "./cn";

type ScriptureProps = {
  /** The passage text. Don't pre-quote — the primitive adds curly quotes. */
  children: ReactNode;
  /** Reference, e.g. "John 3:16". Rendered as the figcaption. */
  reference?: string;
  /** Translation code, e.g. "WEB". Appears in parentheses next to the reference. */
  translation?: string;
  /** External link for "look it up" — typically Bible Gateway. */
  href?: string;
  /** Visual size — "md" (16 px) for inline, "lg" (18 px) default for hero. */
  size?: "md" | "lg";
  className?: string;
};

const sizeClass = {
  md: "text-body",
  lg: "text-body-lg",
} as const;

/**
 * A scripture passage. Set in EB Garamond per the hybrid type rule —
 * Inter for UI / general body, serif specifically for scripture and
 * quoted verse. Wraps semantically in <figure> + <blockquote> +
 * <figcaption> with a smart-quote pair around the passage.
 *
 * The reference, when an href is supplied, becomes a `gold-soft` link
 * that opens externally with proper rel attributes.
 */
export function Scripture({
  children,
  reference,
  translation,
  href,
  size = "lg",
  className,
}: ScriptureProps) {
  const referenceLabel = translation
    ? `${reference} (${translation})`
    : reference;

  return (
    <figure className={cn("space-y-2", className)}>
      <blockquote
        className={cn(
          "font-display text-cream leading-relaxed",
          sizeClass[size],
        )}
      >
        &ldquo;{children}&rdquo;
      </blockquote>
      {reference && (
        <figcaption className="font-sans text-caption text-cream-dim">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold-soft transition-colors duration-fast hover:text-gold focus:outline-none focus-visible:shadow-glow-gold rounded-sm"
            >
              {referenceLabel}
            </a>
          ) : (
            <cite className="not-italic text-gold-soft">{referenceLabel}</cite>
          )}
        </figcaption>
      )}
    </figure>
  );
}
