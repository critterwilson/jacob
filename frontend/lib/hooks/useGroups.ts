"use client";

import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebase";

export type Group = {
  id: string;
  name: string;
  description: string;
  isPrivate: boolean;
  memberCount: number;
  stickerSet: string;
  createdBy: string;
  inviteCode: string;
  schemaVersion: number;
  createdAt: unknown;
};

export function useGroups(uid: string | undefined) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setGroups([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Subscribe to user doc to pick up groupIds changes (backend writes this
    // via ArrayUnion when a group is created or joined).
    const unsub = onSnapshot(
      doc(firestore, "users", uid),
      async (snap) => {
        const groupIds: string[] = snap.exists()
          ? ((snap.data().groupIds as string[] | undefined) ?? [])
          : [];

        if (groupIds.length === 0) {
          setGroups([]);
          setLoading(false);
          return;
        }

        const snaps = await Promise.all(
          groupIds.map((gid) => getDoc(doc(firestore, "groups", gid))),
        );

        setGroups(
          snaps
            .filter((s) => s.exists())
            .map((s) => ({ id: s.id, ...(s.data() as Omit<Group, "id">) })),
        );
        setLoading(false);
      },
      () => {
        setGroups([]);
        setLoading(false);
      },
    );

    return unsub;
  }, [uid]);

  return { groups, loading };
}
