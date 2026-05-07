/**
 * T37 — Responsive photo viewer with srcset for bandwidth efficiency.
 *
 * Accepts the original public GCS URL and computes 320/640/1280 variant
 * URLs by swapping the uploads/ prefix for derived/ and appending _Nw.jpg.
 * Wrapped in a fixed aspect-ratio container to prevent CLS.
 */

import { safeImageSrc } from "@/lib/safeUrl";

type Props = {
  src: string;
  alt: string;
  className?: string;
};

function deriveVariantUrl(originalUrl: string, width: 320 | 640 | 1280): string {
  return originalUrl
    .replace("/uploads/", "/derived/")
    .replace(/\.[^/.]+$/, `_${width}.jpg`);
}

export function PhotoView({ src, alt, className = "" }: Props) {
  const safeSrc = safeImageSrc(src);
  if (!safeSrc) return null;
  const v320 = deriveVariantUrl(safeSrc, 320);
  const v640 = deriveVariantUrl(safeSrc, 640);
  const v1280 = deriveVariantUrl(safeSrc, 1280);

  return (
    <div className={`relative aspect-[4/3] overflow-hidden rounded border border-line ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={safeSrc}
        srcSet={`${v320} 320w, ${v640} 640w, ${v1280} 1280w`}
        sizes="(max-width: 768px) 320px, 640px"
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
