"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";

import { firestore } from "@/lib/firebase";

export type Invite = {
  inviteId: string;
  code: string;
  createdAt: Timestamp | null;
  expiresAt: Timestamp | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: Timestamp | null;
  revokedAt: Timestamp | null;
};

export function useInvites(gid: string) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gid) return;
    const q = query(
      collection(firestore, "groups", gid, "invites"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(
      q,
      (snap) => {
        setInvites(
          snap.docs.map((d) => ({
            inviteId: d.id,
            code: d.data().code as string,
            createdAt: (d.data().createdAt as Timestamp | null) ?? null,
            expiresAt: (d.data().expiresAt as Timestamp | null) ?? null,
            maxUses: (d.data().maxUses as number | null) ?? null,
            useCount: (d.data().useCount as number) ?? 0,
            lastUsedAt: (d.data().lastUsedAt as Timestamp | null) ?? null,
            revokedAt: (d.data().revokedAt as Timestamp | null) ?? null,
          })),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [gid]);

  return { invites, loading };
}
