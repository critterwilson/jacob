"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

type AnnounceResult = {
  announce: (gid: string, mid: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
};

export function useAnnounce(): AnnounceResult {
  const { user } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const announce = async (gid: string, mid: string) => {
    if (!user) return;
    setIsPending(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/groups/${gid}/messages/${mid}/announce`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            "Failed to announce.",
        );
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setIsPending(false);
    }
  };

  return { announce, isPending, error };
}
