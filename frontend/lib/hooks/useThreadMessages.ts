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
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firestore } from "@/lib/firebase";
import type { Message } from "@/lib/hooks/useGroupMessages";

const PAGE_SIZE = 50;

export function useThreadMessages(gid: string | undefined, parentMessageId: string | undefined) {
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    if (!gid || !parentMessageId) {
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
      where("parentMessageId", "==", parentMessageId),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    );

    return onSnapshot(
      q,
      (snap) => {
        if (cursorRef.current === null && snap.docs.length > 0) {
          cursorRef.current = snap.docs[snap.docs.length - 1];
          setHasMore(snap.docs.length === PAGE_SIZE);
        }
        const msgs = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Message, "id">),
        }));
        setRealtimeMessages(msgs.reverse());
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );
  }, [gid, parentMessageId]);

  const loadOlder = useCallback(async () => {
    if (!gid || !parentMessageId || !cursorRef.current || loadingOlderRef.current) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const q = query(
      collection(firestore, "groups", gid, "messages"),
      where("parentMessageId", "==", parentMessageId),
      orderBy("createdAt", "desc"),
      startAfter(cursorRef.current),
      limit(PAGE_SIZE),
    );

    const snap = await getDocs(q);
    const msgs = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Message, "id">) }))
      .reverse();

    if (snap.docs.length > 0) {
      cursorRef.current = snap.docs[snap.docs.length - 1];
    }

    setHasMore(snap.docs.length === PAGE_SIZE);
    setOlderMessages((prev) => [...msgs, ...prev]);

    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [gid, parentMessageId]);

  const messages = useMemo(
    () => [...olderMessages, ...realtimeMessages],
    [olderMessages, realtimeMessages],
  );

  return { messages, loading, loadingOlder, hasMore, loadOlder };
}
