/**
 * T37 — Cloud Function: generate 320/640/1280 JPEG variants on photo upload.
 *
 * Trigger: GCS finalize event on the public bucket for paths matching
 * `uploads/...`. Skips `derived/` paths to prevent re-triggering.
 *
 * Derived files land at `derived/{uid}/{id}_{w}.jpg`, mirroring the
 * `uploads/{uid}/{id}.{ext}` prefix structure.
 *
 * Idempotent: if all three derived files already exist the function exits
 * immediately without re-processing.
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { onObjectFinalized } from "firebase-functions/v2/storage";

import { generateVariants } from "./services/imageVariants";

if (getApps().length === 0) initializeApp();

const WIDTHS = [320, 640, 1280] as const;

export const onPhotoUploadFinalize = onObjectFinalized(
  { memory: "256MiB", timeoutSeconds: 60 },
  async (event) => {
    const { name: objectName, bucket: bucketName, contentType } = event.data;

    if (!objectName) return;
    if (!objectName.startsWith("uploads/")) return;
    if (objectName.includes("derived/")) return; // belt-and-suspenders guard
    if (!contentType?.startsWith("image/")) return;

    const bucket = getStorage().bucket(bucketName);

    // Strip the extension and swap the prefix to form the derived base path.
    const derivedBase = objectName
      .replace(/^uploads\//, "derived/")
      .replace(/\.[^/.]+$/, "");

    // Idempotency: skip if all variants already exist.
    const existResults = await Promise.all(
      WIDTHS.map((w) => bucket.file(`${derivedBase}_${w}.jpg`).exists()),
    );
    if (existResults.every(([exists]) => exists)) return;

    const [imageBytes] = await bucket.file(objectName).download();
    const variants = await generateVariants(imageBytes as Buffer);

    await Promise.all(
      WIDTHS.map((w) =>
        bucket.file(`${derivedBase}_${w}.jpg`).save(variants[`w${w}` as keyof typeof variants], {
          metadata: {
            contentType: "image/jpeg",
            cacheControl: "public, max-age=31536000, immutable",
          },
        }),
      ),
    );
  },
);
