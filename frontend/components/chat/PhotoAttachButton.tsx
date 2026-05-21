"use client";

import { useRef, useState } from "react";

import {
  ALLOWED_PHOTO_MIME_TYPES,
  UploadError,
  useUploadPhoto,
} from "@/lib/hooks/useUploadPhoto";

type Props = {
  gid: string;
  onAttach: (publicUrl: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
};

export function PhotoAttachButton({ gid, onAttach, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading, progress } = useUploadPhoto();
  const [localError, setLocalError] = useState<string | null>(null);

  const reportError = (message: string) => {
    setLocalError(message);
    onError?.(message);
  };

  const handleFile = async (file: File) => {
    setLocalError(null);
    try {
      const url = await upload({ file, purpose: "message", groupId: gid });
      onAttach(url);
    } catch (err) {
      const message =
        err instanceof UploadError ? err.message : "Failed to upload photo.";
      reportError(message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        aria-label="Attach photo"
        className={
          "inline-flex h-9 items-center rounded border border-line bg-ink px-3 text-body-sm text-cream-muted " +
          "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
          "focus:outline-none focus-visible:shadow-glow-gold disabled:opacity-50"
        }
      >
        {uploading
          ? progress === "finalizing"
            ? "Reviewing…"
            : progress === "uploading"
              ? "Uploading…"
              : "Preparing…"
          : "Attach photo"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_PHOTO_MIME_TYPES.join(",")}
        className="sr-only"
        data-testid="photo-attach-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {localError && (
        <span role="alert" className="text-caption text-terracotta">
          {localError}
        </span>
      )}
    </div>
  );
}
