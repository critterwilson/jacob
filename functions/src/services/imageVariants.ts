/**
 * T37 — Pure sharp helpers for generating photo size variants.
 *
 * Outputs 320 / 640 / 1280 px wide JPEGs (height proportional).
 * EXIF/GPS metadata is stripped by default (sharp strips metadata
 * unless .withMetadata() is called).
 */

import sharp from "sharp";

export interface ImageVariants {
  w320: Buffer;
  w640: Buffer;
  w1280: Buffer;
}

const QUALITY: Record<number, number> = { 320: 80, 640: 85, 1280: 90 };

async function resizeJpeg(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input)
    .resize(width, undefined, { withoutEnlargement: true })
    .jpeg({ quality: QUALITY[width] ?? 85 })
    .toBuffer();
}

export async function generateVariants(imageBytes: Buffer): Promise<ImageVariants> {
  const [w320, w640, w1280] = await Promise.all([
    resizeJpeg(imageBytes, 320),
    resizeJpeg(imageBytes, 640),
    resizeJpeg(imageBytes, 1280),
  ]);
  return { w320, w640, w1280 };
}
