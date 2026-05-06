"use client";

import { useState } from "react";

import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type AnnounceResult = {
  gid: string;
  mid: string;
  announcedAt: string;
  notifiedCount: number;
};

export function useAnnounce(gid: string) {
  const { user } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const announce = async (mid: string): Promise<AnnounceResult | null> => {
    if (!user) return null;
    setIsPending(true);
    setError(null);
    try {
      return await apiPost<AnnounceResult>(
        `/api/groups/${gid}/messages/${mid}/announce`,
        undefined,
      );
    } catch (e) {
      if (e instanceof ApiError) {
        setError(
          e.code === "already_announced"
            ? "Message already announced."
            : e.code === "archived"
              ? "Cannot announce in an archived group."
              : "Failed to announce.",
        );
      } else {
        setError("Something went wrong.");
      }
      return null;
    } finally {
      setIsPending(false);
    }
  };

  return { announce, isPending, error };
}
