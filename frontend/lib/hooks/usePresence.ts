"use client";

// T48 — per-group presence over Firebase Realtime Database.
//
// On mount: write `/presence/{gid}/{uid} = { lastSeenAt, status:"online" }`
// and arm `onDisconnect()` to set `status:"offline"`. Heartbeat every
// 60s so a stuck connection that the disconnect hook doesn't catch
// still ages out client-side (`lastSeenAt > now - 90s` = online).
//
// On unmount: cancel the disconnect hook and write `offline`
// immediately so the bar updates without waiting for the server's
// ~30-60s connection timeout.
//
// `presenceEnabled === false` short-circuits the hook to a no-op (no
// writes, no subscription).

import { useEffect, useState } from "react";
import {
  type DataSnapshot,
  off,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set as rtdbSet,
} from "firebase/database";

import { useAuth } from "@/lib/auth-context";
import { rtdb } from "@/lib/firebase";

const HEARTBEAT_MS = 60_000;
const FRESH_THRESHOLD_MS = 90_000;

export type PresenceEntry = {
  uid: string;
  lastSeenAt: number;
};

export function usePresence(
  gid: string | null | undefined,
  presenceEnabled: boolean,
): { online: PresenceEntry[]; loading: boolean } {
  const { user } = useAuth();
  const [online, setOnline] = useState<PresenceEntry[]>([]);
  const [loading, setLoading] = useState(Boolean(gid && presenceEnabled));

  useEffect(() => {
    if (!gid || !presenceEnabled || !user) {
      setOnline([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const myRef = ref(rtdb, `presence/${gid}/${user.uid}`);
    const groupRef = ref(rtdb, `presence/${gid}`);

    const writePresence = async (status: "online" | "offline") => {
      try {
        await rtdbSet(myRef, {
          lastSeenAt: serverTimestamp(),
          status,
        });
      } catch (err) {
        // Permission errors are expected if the membership mirror
        // hasn't propagated yet — log quietly.
        console.warn("presence_write_failed", (err as Error).message);
      }
    };

    void writePresence("online");
    onDisconnect(myRef)
      .set({ lastSeenAt: serverTimestamp(), status: "offline" })
      .catch(() => {
        // Best-effort.
      });

    const heartbeat = setInterval(() => {
      if (!cancelled) void writePresence("online");
    }, HEARTBEAT_MS);

    const handler = (snap: DataSnapshot) => {
      if (cancelled) return;
      const value = snap.val() as Record<
        string,
        { lastSeenAt?: number; status?: string }
      > | null;
      const now = Date.now();
      const out: PresenceEntry[] = [];
      for (const [uid, entry] of Object.entries(value ?? {})) {
        if (!entry) continue;
        if (entry.status !== "online") continue;
        const lastSeen = typeof entry.lastSeenAt === "number" ? entry.lastSeenAt : 0;
        if (now - lastSeen > FRESH_THRESHOLD_MS) continue;
        out.push({ uid, lastSeenAt: lastSeen });
      }
      setOnline(out);
      setLoading(false);
    };
    onValue(groupRef, handler);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      onDisconnect(myRef).cancel().catch(() => undefined);
      void writePresence("offline");
      off(groupRef, "value", handler);
    };
  }, [gid, presenceEnabled, user]);

  return { online, loading };
}
