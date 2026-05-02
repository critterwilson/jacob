"use client";

import { useState } from "react";
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
      const token = await user.getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/groups/${gid}/messages/${mid}/announce`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const msg =
          err?.error?.code === "already_announced"
            ? "Message already announced."
            : err?.error?.code === "archived"
              ? "Cannot announce in an archived group."
              : "Failed to announce.";
        setError(msg);
        return null;
      }
      return (await res.json()) as AnnounceResult;
    } catch {
      setError("Something went wrong.");
      return null;
    } finally {
      setIsPending(false);
    }
  };

  return { announce, isPending, error };
}
