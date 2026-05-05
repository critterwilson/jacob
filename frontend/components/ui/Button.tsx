import { type ButtonHTMLAttributes, forwardRef } from "react";

import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
};

const base =
  "inline-flex items-center justify-center rounded font-sans font-medium " +
  "transition-colors duration-fast " +
  "focus:outline-none focus-visible:shadow-glow-gold " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  // Gold bookmark — used once per surface for the dominant action.
  primary:
    "bg-gold text-ink hover:bg-gold-soft active:bg-gold-deep " +
    "disabled:bg-gold disabled:text-ink",
  // Bordered, sits quietly next to a primary.
  secondary:
    "border border-line text-cream bg-transparent " +
    "hover:bg-ink-raised hover:border-line-strong",
  // No chrome — for tertiary actions inside dense UI.
  ghost: "bg-transparent text-cream hover:bg-ink-raised",
  // Warm-red, never the default; reserved for genuinely destructive.
  destructive:
    "bg-terracotta text-cream hover:opacity-90 active:opacity-100 " +
    "disabled:opacity-50",
};

const sizes: Record<ButtonSize, string> = {
  // 32 px tall — for inline / dense rows.
  sm: "h-8 px-3 text-body-sm gap-1.5",
  // 40 px tall — default. Meets the 40 × 40 touch-target rule with horizontal padding.
  md: "h-10 px-4 text-label gap-2",
  // 48 px tall — primary CTA on auth / landing surfaces.
  lg: "h-12 px-6 text-body gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          base,
          variants[variant],
          sizes[size],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
