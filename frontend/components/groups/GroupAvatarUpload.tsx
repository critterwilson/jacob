"use client";

import { doc, updateDoc } from "firebase/firestore";
import { useRef, useState } from "react";

import { firestore } from "@/lib/firebase";
import { UploadError, useUploadPhoto } from "@/lib/hooks/useUploadPhoto";

type Props = {
  gid: string;
  currentAvatarUrl?: string | null;
};

export function GroupAvatarUpload({ gid, currentAvatarUrl }: Props) {
  const { upload, uploading } = useUploadPhoto();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setPreview(URL.createObjectURL(file));
    try {
      const publicUrl = await upload({ file, purpose: "group_avatar", groupId: gid });
      await updateDoc(doc(firestore, "groups", gid), { avatarUrl: publicUrl });
      setPreview(null);
    } catch (err) {
      setPreview(null);
      if (err instanceof UploadError) {
        if (err.code === "safesearch_blocked") {
          setError("Image was blocked by safety review.");
        } else if (err.code === "too_large") {
          setError("Image must be 8 MB or smaller.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Upload failed. Please try again.");
      }
    }
  };

  const avatarSrc = preview ?? currentAvatarUrl;

  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 overflow-hidden rounded-full bg-gray-200">
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarSrc} alt="Group avatar" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-gray-400">
            G
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Change avatar"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
