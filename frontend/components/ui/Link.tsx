import NextLink, { type LinkProps as NextLinkProps } from "next/link";
import { type AnchorHTMLAttributes, type ReactNode } from "react";

import { cn } from "./cn";

export type LinkVariant = "default" | "accent" | "muted";

type LinkProps = NextLinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof NextLinkProps> & {
    variant?: LinkVariant;
    children: ReactNode;
  };

const variantStyles: Record<LinkVariant, string> = {
  // Cream type, gold underline appears on hover. Default for in-flow links.
  default:
    "text-cream underline decoration-line decoration-1 underline-offset-4 " +
    "hover:decoration-gold hover:text-gold-soft",
  // Gold throughout — for the standout CTA-as-link case.
  accent: "text-gold hover:text-gold-soft underline-offset-4 hover:underline",
  // Quiet — for tertiary links (back-links, "see all", footers).
  muted:
    "text-cream-muted hover:text-cream underline-offset-4 hover:underline",
};

export function Link({
  variant = "default",
  className,
  children,
  ...rest
}: LinkProps) {
  return (
    <NextLink
      className={cn(
        "transition-colors duration-fast " +
          "focus:outline-none focus-visible:shadow-glow-gold rounded-sm",
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </NextLink>
  );
}
