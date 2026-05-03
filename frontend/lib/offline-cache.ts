/**
 * IndexedDB wrapper for caching the last 50 messages per group (T36).
 *
 * Store: "recentMessages", keyed by gid.
 * The database is cleared on sign-out via clearCache().
 */

import type { Message } from "@/lib/hooks/useGroupMessages";

const DB_NAME = "jacob-cache";
const DB_VERSION = 1;
const STORE = "recentMessages";
const MAX_MESSAGES = 50;

interface CacheEntry {
  cacheKey: string;
  messages: Message[];
  cachedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "cacheKey" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheMessages(gid: string, messages: Message[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const entry: CacheEntry = {
      cacheKey: gid,
      messages: messages.slice(-MAX_MESSAGES),
      cachedAt: Date.now(),
    };
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedMessages(gid: string): Promise<Message[] | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(gid);
    req.onsuccess = () => resolve((req.result as CacheEntry | undefined)?.messages ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearCache(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => resolve(); // best-effort; don't block sign-out
  });
}
