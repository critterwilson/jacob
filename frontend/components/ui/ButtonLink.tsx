import NextLink, { type LinkProps as NextLinkProps } from "next/link";
import { type AnchorHTMLAttributes, type ReactNode } from "react";

import {
  type ButtonSize,
  type ButtonVariant,
  type ButtonWidth,
  buttonClasses,
} from "./Button";

type ButtonLinkProps = NextLinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof NextLinkProps> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: ButtonWidth;
    children: ReactNode;
  };

/**
 * A navigational CTA that should *look* like a button. Renders an `<a>` with
 * the exact `Button` styling — use this instead of hand-rolling gold classes
 * onto a link, and never nest a `<Button>` inside a `<Link>`.
 * See docs/design-system.md §9 "Button usage".
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <NextLink
      className={buttonClasses(variant, size, fullWidth, className)}
      {...rest}
    >
      {children}
    </NextLink>
  );
}
