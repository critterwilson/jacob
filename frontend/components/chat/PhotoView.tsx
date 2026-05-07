/**
 * T37 — Responsive photo viewer with srcset for bandwidth efficiency.
 *
 * Accepts the original public GCS URL and computes 320/640/1280 variant
 * URLs by swapping the uploads/ prefix for derived/ and appending _Nw.jpg.
 * Wrapped in a fixed aspect-ratio container to prevent CLS.
 */

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
  const v320 = deriveVariantUrl(src, 320);
  const v640 = deriveVariantUrl(src, 640);
  const v1280 = deriveVariantUrl(src, 1280);

  return (
    <div className={`relative aspect-[4/3] overflow-hidden rounded border border-line ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        srcSet={`${v320} 320w, ${v640} 640w, ${v1280} 1280w`}
        sizes="(max-width: 768px) 320px, 640px"
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
