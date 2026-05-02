"use client";

import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";

import { firestore } from "@/lib/firebase";

export type Member = { uid: string; displayName: string };

export function useMembers(gid: string): { members: Member[]; loading: boolean } {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gid) {
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    void (async () => {
      try {
        const membersSnap = await getDocs(
          collection(firestore, "groups", gid, "members"),
        );
        const uids = membersSnap.docs.map((d) => d.id);

        const userDocs = await Promise.all(
          uids.map((uid) => getDoc(doc(firestore, "users", uid))),
        );

        const result: Member[] = userDocs
          .filter((d) => d.exists())
          .map((d) => ({
            uid: d.id,
            displayName:
              (d.data()?.displayName as string | undefined) ?? d.id,
          }));

        setMembers(result);
      } catch {
        setMembers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [gid]);

  return { members, loading };
}
