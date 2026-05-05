import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "./cn";

export type BannerTone = "info" | "success" | "warning" | "error";

type BannerProps = HTMLAttributes<HTMLDivElement> & {
  tone?: BannerTone;
  /**
   * Optional icon slot. Pass an SVG element. Sized by the parent — the
   * component sets currentColor so the icon tones to the banner.
   */
  icon?: ReactNode;
  /** Optional title; renders above children when present. */
  title?: ReactNode;
  children: ReactNode;
};

const toneStyles: Record<BannerTone, { wrapper: string; bar: string }> = {
  info: {
    wrapper: "bg-ink-raised border-line",
    bar: "bg-lake",
  },
  success: {
    wrapper: "bg-ink-raised border-line",
    bar: "bg-sage",
  },
  warning: {
    wrapper: "bg-ink-raised border-line",
    bar: "bg-parchment-amber",
  },
  error: {
    wrapper: "bg-ink-raised border-line",
    bar: "bg-terracotta",
  },
};

const toneTextColor: Record<BannerTone, string> = {
  info: "text-lake",
  success: "text-sage",
  warning: "text-parchment-amber",
  error: "text-terracotta",
};

/**
 * Inline banner. Page-pinned status messages live here (maintenance,
 * archived, deletion-pending). Toast / queued notifications are a
 * separate primitive — see Toast.tsx.
 *
 * Color is never the only signal: every banner uses both the colored
 * left bar and the optional icon (rendered in the same hue) so users
 * who don't perceive color still get the cue.
 */
export function Banner({
  tone = "info",
  icon,
  title,
  className,
  children,
  ...rest
}: BannerProps) {
  const styles = toneStyles[tone];
  const role = tone === "error" ? "alert" : "status";
  return (
    <div
      role={role}
      className={cn(
        "relative flex gap-3 overflow-hidden rounded-lg border pl-4 pr-4 py-3 " +
          "text-body-sm text-cream",
        styles.wrapper,
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-1", styles.bar)}
      />
      {icon && (
        <span
          aria-hidden="true"
          className={cn("mt-0.5 shrink-0", toneTextColor[tone])}
        >
          {icon}
        </span>
      )}
      <div className="flex-1">
        {title && (
          <p
            className={cn(
              "font-sans text-label",
              toneTextColor[tone],
            )}
          >
            {title}
          </p>
        )}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}
