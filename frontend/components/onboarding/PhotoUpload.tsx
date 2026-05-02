"use client";

// T10 moderation pipeline: avatars are uploaded via signed URL into the
// quarantine bucket, scanned by the backend (CSAM hash + Cloud Vision
// SafeSearch), and only the resulting public URL is shown to the user.

import { useRef, useState } from "react";

import { UploadError, useUploadPhoto } from "@/lib/hooks/useUploadPhoto";

type PhotoUploadProps = {
  uid: string;
  onUploadComplete: (url: string) => void;
  onUploadError: (msg: string) => void;
};

export function PhotoUpload({ onUploadComplete, onUploadError }: PhotoUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading, progress } = useUploadPhoto();

  const handleFile = async (file: File) => {
    try {
      const publicUrl = await upload({ file, purpose: "avatar" });
      setPreviewUrl(publicUrl);
      onUploadComplete(publicUrl);
    } catch (err) {
      const message =
        err instanceof UploadError ? err.message : "Upload failed. Please try again.";
      onUploadError(message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const statusLabel =
    progress === "finalizing"
      ? "Reviewing photo…"
      : progress === "uploading"
        ? "Uploading…"
        : progress === "signing"
          ? "Preparing…"
          : null;

  return (
    <div className="space-y-2">
      <div
        className="flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-50"
        onClick={() => inputRef.current?.click()}
        role="button"
        aria-label="Upload profile photo"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Profile preview" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-gray-400">Add photo</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
        data-testid="photo-input"
      />
      {uploading && statusLabel && (
        <p className="text-xs text-gray-500">{statusLabel}</p>
      )}
      <p className="text-xs text-gray-400">
        Photos are scanned for safety before they appear.
      </p>
    </div>
  );
}
