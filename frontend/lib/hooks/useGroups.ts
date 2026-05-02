"use client";

import {
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  query,
  type Timestamp,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebase";

export const ARCHIVE_HIDE_DAYS = 60;

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
  avatarUrl: string | null;
  archivedAt: Timestamp | null;
  archivedBy: string | null;
  archiveReason: string | null;
};

/**
 * Returns every group the user belongs to.
 *
 * As of M11, memberships are derived from a collection-group query on
 * the `members` subcollection (filtered by the `uid` field) rather than
 * the legacy `users/{uid}.groupIds` mirror. Each member doc is created
 * by the backend with `uid` equal to the doc ID, and the security rule
 * still permits per-doc reads via `isUser(uid)` — see
 * `docs/adr/0003-collection-group-memberships.md`.
 */
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

    const membersQuery = query(
      collectionGroup(firestore, "members"),
      where("uid", "==", uid),
    );

    const unsub = onSnapshot(
      membersQuery,
      async (snap) => {
        const gids = snap.docs
          .map((d) => d.ref.parent.parent?.id)
          .filter((id): id is string => Boolean(id));

        if (gids.length === 0) {
          setGroups([]);
          setLoading(false);
          return;
        }

        const groupSnaps = await Promise.all(
          gids.map((gid) => getDoc(doc(firestore, "groups", gid))),
        );

        const cutoffMs = Date.now() - ARCHIVE_HIDE_DAYS * 24 * 60 * 60 * 1000;
        setGroups(
          groupSnaps
            .filter((s) => s.exists())
            .map((s) => ({ id: s.id, ...(s.data() as Omit<Group, "id">) }))
            .filter((g) => {
              const archived = g.archivedAt as Timestamp | null | undefined;
              if (!archived) return true;
              return archived.toMillis() >= cutoffMs;
            }),
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
