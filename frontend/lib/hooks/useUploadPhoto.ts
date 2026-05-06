"use client";

// Drives the T10 moderation pipeline from the client side:
// 1. POST /api/uploads/photos → signed PUT URL into the quarantine bucket.
// 2. PUT bytes directly to GCS.
// 3. POST /api/uploads/{id}/finalize → on pass, the public URL is returned.
//
// Errors bubble up as `UploadError` with a stable `code` so callers can
// surface the right message (oversize, mime, rejected by safety, etc.).

import { useCallback, useState } from "react";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export const ALLOWED_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export type UploadPurpose = "message" | "avatar" | "group_avatar";

export type UploadOptions = {
  file: File;
  purpose: UploadPurpose;
  groupId?: string;
};

export type UploadErrorCode =
  | "invalid_mime"
  | "too_large"
  | "unauthenticated"
  | "missing_group"
  | "forbidden"
  | "csam_hash_match"
  | "safesearch_blocked"
  | "network_error"
  | "upload_failed"
  | "server_error";

export class UploadError extends Error {
  readonly code: UploadErrorCode;

  constructor(code: UploadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "UploadError";
  }
}

type CreateResponse = {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
};

type FinalizeResponse = {
  publicUrl: string;
};

function isAllowedMime(value: string): value is AllowedPhotoMimeType {
  return (ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

export function useUploadPhoto() {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<"idle" | "signing" | "uploading" | "finalizing">(
    "idle",
  );

  const upload = useCallback(
    async ({ file, purpose, groupId }: UploadOptions): Promise<string> => {
      if (!isAllowedMime(file.type)) {
        throw new UploadError(
          "invalid_mime",
          "Photo must be JPEG, PNG, or WebP.",
        );
      }
      if (file.size > MAX_PHOTO_BYTES) {
        throw new UploadError("too_large", "Photo must be 8 MB or smaller.");
      }
      if (!user) {
        throw new UploadError("unauthenticated", "You must be signed in to upload.");
      }
      if (purpose === "message" && !groupId) {
        throw new UploadError(
          "missing_group",
          "groupId is required for message uploads.",
        );
      }

      setUploading(true);
      setProgress("signing");
      try {
        // Step 1: ask the backend for a signed PUT URL
        let signed: CreateResponse;
        try {
          signed = await apiPost<CreateResponse>("/api/uploads/photos", {
            purpose,
            mimeType: file.type,
            byteCount: file.size,
            ...(groupId ? { groupId } : {}),
          });
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.status === 403) {
              throw new UploadError(
                "forbidden",
                "You can't upload to this group.",
              );
            }
            throw new UploadError(
              (e.code as UploadErrorCode) || "server_error",
              "Could not start upload.",
            );
          }
          throw e;
        }

        // Step 2: PUT bytes directly to GCS via the signed URL. This is a
        // cross-origin request to a Google-issued URL with no Authorization
        // header (the signature is the auth) and no JSON body — it
        // intentionally does NOT go through lib/api.ts.
        setProgress("uploading");
        // eslint-disable-next-line no-restricted-syntax
        const putRes = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) {
          throw new UploadError(
            "upload_failed",
            "Upload to storage failed. Please try again.",
          );
        }

        // Step 3: finalize. Backend runs hash + SafeSearch then returns the
        // public URL only on pass.
        setProgress("finalizing");
        try {
          const final = await apiPost<FinalizeResponse>(
            `/api/uploads/${signed.uploadId}/finalize`,
            undefined,
          );
          return final.publicUrl;
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.status === 451) {
              throw new UploadError(
                "csam_hash_match",
                "This image cannot be uploaded.",
              );
            }
            if (e.status === 422) {
              throw new UploadError(
                "safesearch_blocked",
                "This image was blocked by safety review.",
              );
            }
            throw new UploadError("server_error", "Could not finalize upload.");
          }
          throw e;
        }
      } catch (err) {
        if (err instanceof UploadError) throw err;
        throw new UploadError("network_error", "Network error during upload.");
      } finally {
        setUploading(false);
        setProgress("idle");
      }
    },
    [user],
  );

  return { upload, uploading, progress };
}
