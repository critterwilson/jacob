"use client";

import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QueryDocumentSnapshot,
  startAfter,
  type Timestamp,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firestore } from "@/lib/firebase";

const PAGE_SIZE = 50;

export type ModerationState = "scored" | "flagged" | "hidden" | "skipped" | "errored";

export type ModerationFields = {
  state: ModerationState;
  reasons: string[];
  scores: Record<string, number> | null;
  scoredAt: Timestamp | null;
  policy?: string;
};

export type Message = {
  id: string;
  authorUid: string;
  body: string;
  stickerIds: string[];
  createdAt: Timestamp | null;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  parentMessageId: string | null;
  threadReplyCount: number;
  mediaRefs: string[];
  participants?: string[];
  repostOfThread?: string | null;
  moderation?: ModerationFields | null;
  announcedAt?: Timestamp | null;
  announcedBy?: string | null;
  reactionCounts?: Record<string, number>;
};

function docToMessage(d: QueryDocumentSnapshot): Message {
  return { id: d.id, ...(d.data() as Omit<Message, "id">) };
}

export function useGroupMessages(gid: string | undefined) {
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Points to the oldest document we have; initialised on first snapshot,
  // then advanced by loadOlder() as older pages are fetched.
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    if (!gid) {
      setRealtimeMessages([]);
      setOlderMessages([]);
      setLoading(false);
      setHasMore(false);
      return;
    }

    cursorRef.current = null;
    setRealtimeMessages([]);
    setOlderMessages([]);
    setLoading(true);
    setHasMore(false);

    const q = query(
      collection(firestore, "groups", gid, "messages"),
      where("parentMessageId", "==", null),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    );

    return onSnapshot(
      q,
      (snap) => {
        // Set cursor only on first fire — don't overwrite a loadOlder cursor.
        if (cursorRef.current === null && snap.docs.length > 0) {
          cursorRef.current = snap.docs[snap.docs.length - 1];
          setHasMore(snap.docs.length === PAGE_SIZE);
        }
        setRealtimeMessages(snap.docs.map(docToMessage).reverse());
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );
  }, [gid]);

  const loadOlder = useCallback(async () => {
    if (!gid || !cursorRef.current || loadingOlderRef.current) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const q = query(
      collection(firestore, "groups", gid, "messages"),
      where("parentMessageId", "==", null),
      orderBy("createdAt", "desc"),
      startAfter(cursorRef.current),
      limit(PAGE_SIZE),
    );

    const snap = await getDocs(q);
    const msgs = snap.docs.map(docToMessage).reverse();

    if (snap.docs.length > 0) {
      cursorRef.current = snap.docs[snap.docs.length - 1];
    }

    setHasMore(snap.docs.length === PAGE_SIZE);
    setOlderMessages((prev) => [...msgs, ...prev]);

    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [gid]);

  const messages = useMemo(
    () => [...olderMessages, ...realtimeMessages],
    [olderMessages, realtimeMessages],
  );

  return { messages, loading, loadingOlder, hasMore, loadOlder };
}
