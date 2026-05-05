import { type HTMLAttributes, forwardRef } from "react";

import { cn } from "./cn";

export type CardSurface = "raised" | "overlay";
export type CardPadding = "none" | "sm" | "md" | "lg";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  surface?: CardSurface;
  padding?: CardPadding;
  /** Adds hover state — use when the entire card is a click target. */
  interactive?: boolean;
};

const surfaceStyles: Record<CardSurface, string> = {
  raised: "bg-ink-raised border border-line shadow-raise",
  overlay: "bg-ink-overlay border border-line shadow-pop",
};

const paddingStyles: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-8",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    surface = "raised",
    padding = "md",
    interactive = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg",
        surfaceStyles[surface],
        paddingStyles[padding],
        interactive &&
          "transition-colors duration-fast hover:border-line-strong",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
