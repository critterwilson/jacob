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
  /**
   * When set, render as a compact 44 × 44 icon button (paperclip) that
   * fits inline next to the composer textarea. Defaults to the legacy
   * labelled-button rendering so non-chat callers (if any) keep their
   * current appearance.
   */
  variant?: "icon" | "labelled";
};

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m21 12-8.485 8.485a5 5 0 0 1-7.071-7.071l8.485-8.485a3 3 0 0 1 4.243 4.243l-8.31 8.31a1 1 0 0 1-1.415-1.414l7.61-7.61" />
    </svg>
  );
}

export function PhotoAttachButton({
  gid,
  onAttach,
  onError,
  disabled,
  variant = "labelled",
}: Props) {
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

  if (variant === "icon") {
    return (
      <>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          aria-label={uploading ? "Uploading photo" : "Attach photo"}
          aria-busy={uploading || undefined}
          className={
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cream-muted " +
            "transition-colors duration-fast hover:bg-ink-overlay hover:text-cream " +
            "focus:outline-none focus-visible:shadow-glow-gold disabled:opacity-50"
          }
        >
          <PaperclipIcon className="h-5 w-5" />
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
          <span role="alert" className="sr-only">
            {localError}
          </span>
        )}
      </>
    );
  }

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
