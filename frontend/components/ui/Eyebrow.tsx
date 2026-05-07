import { type HTMLAttributes } from "react";

import { cn } from "./cn";

type EyebrowProps = HTMLAttributes<HTMLSpanElement>;

/**
 * Small uppercase tag that introduces a section. Usually the title of
 * the section in muted form, sits above a Heading.
 *
 *   <Eyebrow>Devotional</Eyebrow>
 *   <Heading level={2}>The vine and the branches</Heading>
 */
export function Eyebrow({ className, children, ...rest }: EyebrowProps) {
  return (
    <span
      className={cn(
        "font-sans text-eyebrow uppercase text-cream-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
