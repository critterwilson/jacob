"use client";

import {
  collection,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";

import { firestore } from "@/lib/firebase";

export type BoardPost = {
  postId: string;
  authorUid: string;
  body: string;
  stickerIds: string[];
  mediaRefs: string[];
  createdAt: Timestamp | null;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  pinnedAt: Timestamp | null;
  pinnedBy: string | null;
  mentions?: string[];
  reactionCounts?: Record<string, number>;
  replyCount: number;
  moderation?: { state?: string; reasons?: string[] };
};

const PAGE_SIZE = 50;

export function useBoardPosts(boardId: string) {
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!boardId) return;
    // Filter out client-side soft-deleted; ordering goes pinned-first then
    // by createdAt desc.
    const q = query(
      collection(firestore, "boards", boardId, "posts"),
      where("deletedAt", "==", null),
      orderBy("pinnedAt", "desc"),
      orderBy("createdAt", "desc"),
      fbLimit(PAGE_SIZE),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: BoardPost[] = snap.docs.map((d) => {
        const data = d.data() as Omit<BoardPost, "postId">;
        return { postId: d.id, ...data };
      });
      setPosts(next);
      setLoading(false);
    });
    return () => unsub();
  }, [boardId]);

  return { posts, loading };
}
