"use client";

import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebase";

export type Sticker = {
  id: string;
  slug: string;
  name: string;
  audience: string;
  order: number;
  color: string;
};

// Module-level cache — one fetch per browser session, cleared on page reload.
let _cache: Sticker[] | null = null;
let _promise: Promise<Sticker[]> | null = null;

function loadStickers(): Promise<Sticker[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = getDocs(
    query(collection(firestore, "stickers"), orderBy("order")),
  ).then((snap) => {
    _cache = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Sticker, "id">),
    }));
    _promise = null;
    return _cache;
  });
  return _promise;
}

export function useStickers() {
  const [stickers, setStickers] = useState<Sticker[]>(() => _cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) {
      setStickers(_cache);
      setLoading(false);
      return;
    }
    loadStickers()
      .then((s) => {
        setStickers(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { stickers, loading };
}
