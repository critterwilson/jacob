"use client";

// T48 — typing indicators per group, over Realtime Database.
//
// The hook returns:
//   - `others`: list of other users currently typing (filtered to
//     entries fresher than 8s)
//   - `setTyping(active)`: callers (the chat input) flip this on every
//     input change. Internally the hook batches writes — a write only
//     happens if the previous typing record is > 2s old, so spam-typing
//     doesn't flood RTDB.
//
// `presenceEnabled === false` short-circuits to no-op. (The same flag
// gates both presence and typing — it's the "social signal off"
// switch.)

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DataSnapshot,
  off,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set as rtdbSet,
} from "firebase/database";

import { useAuth } from "@/lib/auth-context";
import { rtdb } from "@/lib/firebase";

const FRESH_THRESHOLD_MS = 8_000;
const WRITE_DEBOUNCE_MS = 2_000;
const STOP_TIMEOUT_MS = 5_000;

export type TypingEntry = { uid: string; startedAt: number };

export function useTyping(
  gid: string | null | undefined,
  presenceEnabled: boolean,
): { others: TypingEntry[]; setTyping: (active: boolean) => void } {
  const { user } = useAuth();
  const [others, setOthers] = useState<TypingEntry[]>([]);
  const lastWriteRef = useRef<number>(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeStop = useCallback(() => {
    if (!gid || !user) return;
    const myRef = ref(rtdb, `typing/${gid}/${user.uid}`);
    void remove(myRef).catch(() => undefined);
    lastWriteRef.current = 0;
  }, [gid, user]);

  const setTyping = useCallback(
    (active: boolean) => {
      if (!gid || !user || !presenceEnabled) return;
      if (!active) {
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        writeStop();
        return;
      }
      const now = Date.now();
      if (now - lastWriteRef.current > WRITE_DEBOUNCE_MS) {
        lastWriteRef.current = now;
        const myRef = ref(rtdb, `typing/${gid}/${user.uid}`);
        void rtdbSet(myRef, { startedAt: serverTimestamp() }).catch(() =>
          undefined,
        );
      }
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => writeStop(), STOP_TIMEOUT_MS);
    },
    [gid, user, presenceEnabled, writeStop],
  );

  useEffect(() => {
    if (!gid || !user || !presenceEnabled) {
      setOthers([]);
      return;
    }
    const groupRef = ref(rtdb, `typing/${gid}`);
    const handler = (snap: DataSnapshot) => {
      const value = snap.val() as Record<string, { startedAt?: number }> | null;
      const now = Date.now();
      const out: TypingEntry[] = [];
      for (const [uid, entry] of Object.entries(value ?? {})) {
        if (uid === user.uid) continue;
        const started = typeof entry?.startedAt === "number" ? entry.startedAt : 0;
        if (now - started > FRESH_THRESHOLD_MS) continue;
        out.push({ uid, startedAt: started });
      }
      setOthers(out);
    };
    onValue(groupRef, handler);
    return () => {
      off(groupRef, "value", handler);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      writeStop();
    };
  }, [gid, user, presenceEnabled, writeStop]);

  return { others, setTyping };
}
