"use client";

import { doc, updateDoc } from "firebase/firestore";
import { useRef, useState } from "react";

import { firestore } from "@/lib/firebase";
import {
  ALLOWED_PHOTO_MIME_TYPES,
  UploadError,
  useUploadPhoto,
} from "@/lib/hooks/useUploadPhoto";

type Props = {
  gid: string;
  currentAvatarUrl: string | null;
};

export function GroupAvatarUpload({ gid, currentAvatarUrl }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading, progress } = useUploadPhoto();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentAvatarUrl);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const publicUrl = await upload({ file, purpose: "group_avatar", groupId: gid });
      await updateDoc(doc(firestore, "groups", gid), { avatarUrl: publicUrl });
      setPreview(publicUrl);
    } catch (err) {
      const message =
        err instanceof UploadError ? err.message : "Failed to upload avatar.";
      setError(message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const progressLabel =
    progress === "finalizing"
      ? "Reviewing…"
      : progress === "uploading"
        ? "Uploading…"
        : "Preparing…";

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Group avatar" className="h-full w-full object-cover" />
        ) : (
          <span className="text-2xl text-gray-400">👥</span>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {uploading ? progressLabel : "Upload avatar"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_PHOTO_MIME_TYPES.join(",")}
          className="sr-only"
          data-testid="avatar-upload-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>
        )}
      </div>
    </div>
  );
}
