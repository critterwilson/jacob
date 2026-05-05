import { type HTMLAttributes, type JSX, createElement } from "react";

import { cn } from "./cn";

export type HeadingLevel = 1 | 2 | 3 | 4;
export type HeadingSize = "xl" | "lg" | "md" | "sm";

type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  /** Semantic level (h1–h4). Drives the rendered tag. */
  level?: HeadingLevel;
  /**
   * Visual size override. Defaults to the size matching `level`
   * (1→xl, 2→lg, 3→md, 4→sm). Use to set a small heading for layout
   * reasons while keeping the correct semantic level.
   */
  size?: HeadingSize;
};

const sizeClass: Record<HeadingSize, string> = {
  xl: "text-display-xl",
  lg: "text-display-lg",
  md: "text-display-md",
  sm: "text-display-sm",
};

const defaultSizeForLevel: Record<HeadingLevel, HeadingSize> = {
  1: "xl",
  2: "lg",
  3: "md",
  4: "sm",
};

export function Heading({
  level = 1,
  size,
  className,
  children,
  ...rest
}: HeadingProps) {
  const tag = `h${level}` as keyof JSX.IntrinsicElements;
  const resolvedSize = size ?? defaultSizeForLevel[level];
  return createElement(
    tag,
    {
      className: cn(
        "font-display text-cream tracking-tight",
        sizeClass[resolvedSize],
        className,
      ),
      ...rest,
    },
    children,
  );
}
