import { type HTMLAttributes } from "react";

import { cn } from "./cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

type AvatarProps = HTMLAttributes<HTMLDivElement> & {
  /** displayName used both for the alt text and the initial fallback. */
  name: string;
  /** Optional photoURL. Falls back to the first letter of `name` on ink-overlay. */
  photoURL?: string | null;
  size?: AvatarSize;
};

const sizeStyles: Record<AvatarSize, { box: string; text: string }> = {
  xs: { box: "h-6 w-6", text: "text-[10px]" },
  sm: { box: "h-8 w-8", text: "text-caption" },
  md: { box: "h-10 w-10", text: "text-body-sm" },
  lg: { box: "h-12 w-12", text: "text-body" },
};

function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

/**
 * Round avatar. Renders the photo when supplied; otherwise the first
 * letter of the name on an ink-overlay swatch.
 *
 * Decorative wrappers around message rows pass `aria-hidden` because
 * the author name is already rendered next to the avatar — no need
 * for a screen reader to hear it twice.
 */
export function Avatar({
  name,
  photoURL,
  size = "sm",
  className,
  ...rest
}: AvatarProps) {
  const styles = sizeStyles[size];
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-full bg-ink-overlay",
        styles.box,
        className,
      )}
      {...rest}
    >
      {photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoURL}
          alt={name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-full w-full items-center justify-center font-sans font-medium uppercase text-cream-muted",
            styles.text,
          )}
        >
          {initial(name)}
        </span>
      )}
    </div>
  );
}
