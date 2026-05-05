/**
 * Tiny class-name joiner. Filters falsy values and joins with spaces.
 * Avoids pulling clsx into the bundle for the primitives layer.
 */
export function cn(
  ...args: (string | false | null | undefined)[]
): string {
  return args.filter(Boolean).join(" ");
}
