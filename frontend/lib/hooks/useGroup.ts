"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebase";
import type { Group } from "@/lib/hooks/useGroups";

export function useGroup(gid: string | undefined) {
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gid) {
      setGroup(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    return onSnapshot(
      doc(firestore, "groups", gid),
      (snap) => {
        setGroup(
          snap.exists()
            ? { id: snap.id, ...(snap.data() as Omit<Group, "id">) }
            : null,
        );
        setLoading(false);
      },
      () => {
        setGroup(null);
        setLoading(false);
      },
    );
  }, [gid]);

  return { group, loading };
}
