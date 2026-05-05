import { type HTMLAttributes } from "react";

import { cn } from "./cn";

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Single placeholder block for loading state. Replaces the previous
 * mix of "Loading…" text and animate-pulse divs scattered through the
 * app. Tinted into the ink palette so it doesn't look like a grey
 * sticker stuck on the page.
 *
 * The pulse respects prefers-reduced-motion via the duration token.
 */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded bg-ink-overlay",
        className,
      )}
      {...rest}
    />
  );
}
