"use client";

import { useRef, useState } from "react";

import { Avatar, Button } from "@/components/ui";
import { apiPatch } from "@/lib/api";
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
      const publicUrl = await upload({
        file,
        purpose: "group_avatar",
        groupId: gid,
      });
      await apiPatch(`/api/groups/${gid}`, { avatarUrl: publicUrl });
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

  const avatarSrc = preview ?? currentAvatarUrl ?? null;

  return (
    <div className="flex items-center gap-4">
      <Avatar name="Group" photoURL={avatarSrc} size="lg" />

      <div className="space-y-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Change avatar"}
        </Button>
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
          <p role="alert" className="text-caption text-terracotta">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
