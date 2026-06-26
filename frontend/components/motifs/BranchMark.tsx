import { cn } from "@/components/ui";

/**
 * The Branch brand mark: the owner's real tree logo, cut directly from the
 * source image (never redrawn). Two cutouts ship so the mark reads on any
 * ground; CSS (see app/globals.css) reveals the right one for the current
 * theme with no JS, so it works under SSR and the system-preference path
 * without a flash:
 *   - light ground → branch-tree.png       (espresso cutout)
 *   - dark  ground → branch-tree-light.png  (parchment knockout)
 *
 * Decorative by default (the wordmark beside it carries the name). Pass
 * `alt` when the mark stands alone and needs an accessible name.
 *
 * Size it via `className` (e.g. `h-32 w-auto`) — the class is applied to the
 * image so the wrapper tracks its width.
 */
export function BranchMark({
  className,
  alt,
}: {
  className?: string;
  alt?: string;
}) {
  const decorative = !alt;
  const imgClass = (variant: "on-light" | "on-dark") =>
    cn(`branch-mark--${variant}`, "w-auto select-none", className);
  return (
    <span className="inline-flex shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/branch-tree.png"
        width={510}
        height={608}
        alt={decorative ? "" : alt}
        aria-hidden={decorative || undefined}
        draggable={false}
        className={imgClass("on-light")}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/branch-tree-light.png"
        width={510}
        height={608}
        alt={decorative ? "" : alt}
        aria-hidden={decorative || undefined}
        draggable={false}
        className={imgClass("on-dark")}
      />
    </span>
  );
}
