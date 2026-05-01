"use client";

// Temporary avatar path — T10 not yet integrated.
// Uploaded files go to users/{uid}/uncheckedAvatar in Firebase Storage and
// are visible only to the uploader until T10's moderation pipeline runs.
// See docs/temporary-avatar-flow.md for the full plan.

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useRef, useState } from "react";
import { storage } from "@/lib/firebase";

type PhotoUploadProps = {
  uid: string;
  onUploadComplete: (url: string) => void;
  onUploadError: (msg: string) => void;
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

export function PhotoUpload({ uid, onUploadComplete, onUploadError }: PhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      onUploadError("Photo must be JPEG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      onUploadError("Photo must be 8 MB or smaller.");
      return;
    }

    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const storageRef = ref(storage, `users/${uid}/uncheckedAvatar`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);
      onUploadComplete(url);
    } catch {
      onUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

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
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Profile preview" className="h-full w-full object-cover" />
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
          if (file) handleFile(file);
        }}
        data-testid="photo-input"
      />
      {uploading && <p className="text-xs text-gray-500">Uploading…</p>}
      <p className="text-xs text-gray-400">Pending moderation — visible only to you until verified.</p>
    </div>
  );
}
