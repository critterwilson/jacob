"use client";

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { useEffect, useState } from "react";

import { firestore } from "@/lib/firebase";
import type { BoardPost } from "./useBoardPosts";

export type BoardReply = {
  replyId: string;
  authorUid: string;
  body: string;
  stickerIds: string[];
  mediaRefs: string[];
  createdAt: Timestamp | null;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  mentions?: string[];
  moderation?: { state?: string; reasons?: string[] };
};

export function useBoardPost(boardId: string, postId: string) {
  const [post, setPost] = useState<BoardPost | null>(null);
  const [replies, setReplies] = useState<BoardReply[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!boardId || !postId) return;
    const postRef = doc(firestore, "boards", boardId, "posts", postId);
    const unsubPost = onSnapshot(postRef, (snap) => {
      if (!snap.exists()) {
        setPost(null);
        setLoading(false);
        return;
      }
      const data = snap.data() as Omit<BoardPost, "postId">;
      setPost({ postId: snap.id, ...data });
      setLoading(false);
    });

    const repliesQ = query(
      collection(firestore, "boards", boardId, "posts", postId, "replies"),
      orderBy("createdAt", "asc"),
    );
    const unsubReplies = onSnapshot(repliesQ, (snap) => {
      const next = snap.docs.map((d) => {
        const data = d.data() as Omit<BoardReply, "replyId">;
        return { replyId: d.id, ...data };
      });
      setReplies(next);
    });

    return () => {
      unsubPost();
      unsubReplies();
    };
  }, [boardId, postId]);

  return { post, replies, loading };
}
