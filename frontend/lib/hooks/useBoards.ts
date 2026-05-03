"use client";

import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { useEffect, useState } from "react";

import { firestore } from "@/lib/firebase";

export type Board = {
  boardId: string;
  name: string;
  slug: string;
  description: string;
  audience: "christian" | "general";
  archivedAt: Timestamp | null;
  postCount: number;
};

export function useBoards() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(firestore, "boards"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Board[] = snap.docs.map((d) => {
          const data = d.data() as Omit<Board, "boardId">;
          return { boardId: d.id, ...data };
        });
        setBoards(next.filter((b) => b.archivedAt == null));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  return { boards, loading, error };
}
